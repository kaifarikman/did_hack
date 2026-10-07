import type { MapMode, MissionSnapshot, Scenario, StartRunRequest } from "../domain/contract";
import { mergeJournalEntries, type JournalExport } from "../domain/journal";
import { isActiveStatus } from "../domain/presentation";
import { describeError, isUnknownOutcome } from "./errorMessages";
import { ExportCancelledError, exportFullJournal } from "./exportJournal";
import type { MissionGateway, Scheduler } from "./ports";
import {
  IDLE_COMMAND,
  startDisabledReason,
  stopDisabledReason,
  type JournalState,
  type MissionViewState,
} from "./viewState";

export interface ControllerOptions {
  gateway: MissionGateway;
  scheduler: Scheduler;
  generateId: () => string;
  pollIntervalMs?: number;
  staleAfterMs?: number;
  healthIntervalMs?: number;
  mapRetryMs?: number;
  journalPageSize?: number;
  awaitTimeoutMs?: number;
}

interface PendingCommand {
  kind: "start" | "stop";
  requestId: string;
  startBody: StartRunRequest | null;
  baselineRunId: string | null;
  stopRunId: string | null;
  sentAt: number;
  /** Номер последнего отправленного запроса на момент сбоя: сверка возможна только более новым ответом. */
  failedAtSeq: number | null;
}

const STOP_CONFIRMED_STATUSES = ["stopping", "stopped", "failed", "completed"];
const EMPTY_JOURNAL: JournalState = {
  runId: null,
  entries: [],
  nextSequence: 0,
  hasMore: false,
  fetchedRevision: null,
  error: null,
};

/**
 * Единственный владелец живых данных панели: опрос, устаревание, карта, журнал и команды.
 * Не знает о React, HTTP и браузере: всё внешнее приходит через порты.
 */
export class MissionController {
  private readonly gateway: MissionGateway;
  private readonly scheduler: Scheduler;
  private readonly generateId: () => string;
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly healthIntervalMs: number;
  private readonly mapRetryMs: number;
  private readonly journalPageSize: number;
  private readonly awaitTimeoutMs: number;

  private view: MissionViewState = {
    health: null,
    snapshot: null,
    map: null,
    mapError: null,
    connection: "connecting",
    connectionError: null,
    journal: EMPTY_JOURNAL,
    selectedHypothesisId: null,
    command: IDLE_COMMAND,
    exportState: { phase: "idle", message: null },
  };
  private readonly listeners = new Set<() => void>();

  private running = false;
  private generation = 0;
  private lifecycle: AbortController | null = null;
  private cancelTimers: Array<() => void> = [];

  private startedAt = 0;
  private lastSuccessAt: number | null = null;
  private requestSeq = 0;
  private lastAppliedSeq = 0;
  private lastMapAttemptAt: number | null = null;

  private stateInFlight = false;
  private healthInFlight = false;
  private mapInFlight = false;
  private journalInFlight = false;
  private exportInFlight = false;

  private pending: PendingCommand | null = null;

  constructor(options: ControllerOptions) {
    this.gateway = options.gateway;
    this.scheduler = options.scheduler;
    this.generateId = options.generateId;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.staleAfterMs = options.staleAfterMs ?? 3000;
    this.healthIntervalMs = options.healthIntervalMs ?? 2000;
    this.mapRetryMs = options.mapRetryMs ?? 2000;
    this.journalPageSize = options.journalPageSize ?? 100;
    this.awaitTimeoutMs = options.awaitTimeoutMs ?? 10000;
  }

  // ---- подписка ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): MissionViewState => this.view;

  private update(patch: Partial<MissionViewState>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ---- жизненный цикл ----

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.lifecycle = new AbortController();
    this.startedAt = this.scheduler.now();
    this.stateInFlight = false;
    this.healthInFlight = false;
    this.mapInFlight = false;
    this.journalInFlight = false;
    void this.pollState();
    void this.pollHealth();
    this.scheduleStaleCheck();
    this.ensureMap();
  }

  dispose(): void {
    this.running = false;
    this.generation += 1;
    this.lifecycle?.abort();
    this.lifecycle = null;
    for (const cancel of this.cancelTimers) cancel();
    this.cancelTimers = [];
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private schedule(callback: () => void, delayMs: number): void {
    let cancel: () => void = () => undefined;
    cancel = this.scheduler.setTimeout(() => {
      this.cancelTimers = this.cancelTimers.filter((timer) => timer !== cancel);
      callback();
    }, delayMs);
    this.cancelTimers.push(cancel);
  }

  // ---- опрос состояния ----

  private async pollState(): Promise<void> {
    if (!this.running || this.stateInFlight) return;
    this.stateInFlight = true;
    const generation = this.generation;
    const startedAt = this.scheduler.now();
    const seq = ++this.requestSeq;
    try {
      const snapshot = await this.gateway.getState({ signal: this.lifecycle?.signal });
      if (this.isCurrent(generation)) this.acceptSnapshot(snapshot, seq);
    } catch (error) {
      if (this.isCurrent(generation)) this.update({ connectionError: describeError(error) });
    } finally {
      if (this.generation === generation) {
        this.stateInFlight = false;
        if (this.running) {
          const elapsed = this.scheduler.now() - startedAt;
          this.schedule(() => void this.pollState(), Math.max(this.pollIntervalMs - elapsed, 0));
        }
      }
    }
  }

  private async pollHealth(): Promise<void> {
    if (!this.running || this.healthInFlight) return;
    this.healthInFlight = true;
    const generation = this.generation;
    try {
      const health = await this.gateway.getHealth({ signal: this.lifecycle?.signal });
      if (this.isCurrent(generation)) this.update({ health });
    } catch {
      if (this.isCurrent(generation)) this.update({ health: null });
    } finally {
      if (this.generation === generation) {
        this.healthInFlight = false;
        if (this.running) this.schedule(() => void this.pollHealth(), this.healthIntervalMs);
      }
    }
  }

  private scheduleStaleCheck(): void {
    const generation = this.generation;
    this.schedule(() => {
      if (!this.isCurrent(generation)) return;
      this.checkStaleness();
      this.checkAwaitTimeout();
      this.scheduleStaleCheck();
    }, Math.min(this.pollIntervalMs, 500));
  }

  private checkStaleness(): void {
    const baseline = this.lastSuccessAt ?? this.startedAt;
    if (this.scheduler.now() - baseline >= this.staleAfterMs && this.view.connection !== "stale") {
      this.update({ connection: "stale" });
    }
  }

  private checkAwaitTimeout(): void {
    const { command } = this.view;
    if (command.phase !== "awaiting" || this.pending === null) return;
    if (this.scheduler.now() - this.pending.sentAt < this.awaitTimeoutMs) return;
    this.pending = null;
    this.update({
      command: {
        phase: "failed",
        kind: command.kind,
        message: "Команда принята, но переход состояния не подтверждён. Проверьте статус прогона.",
        canRetry: false,
      },
    });
  }

  // ---- применение снимка ----

  /** Любой успешный ответ состояния подтверждает связь; применяется только если не старее уже применённого. */
  private acceptSnapshot(snapshot: MissionSnapshot, seq: number): void {
    this.lastSuccessAt = this.scheduler.now();
    this.update({ connection: "live", connectionError: null });
    this.applySnapshot(snapshot, seq);
    this.ensureMap();
    void this.syncJournal();
  }

  private applySnapshot(snapshot: MissionSnapshot, seq: number): void {
    if (seq < this.lastAppliedSeq) return;
    const previous = this.view.snapshot;
    if (previous !== null && previous.run_id === snapshot.run_id && snapshot.revision < previous.revision) {
      return;
    }
    this.lastAppliedSeq = seq;
    const runChanged = previous?.run_id !== snapshot.run_id;
    const patch: Partial<MissionViewState> = { snapshot };
    if (runChanged) {
      patch.journal = { ...EMPTY_JOURNAL, runId: snapshot.run_id };
      patch.selectedHypothesisId = null;
    }
    this.update(patch);
    this.reconcileCommand(snapshot, seq);
  }

  // ---- карта ----

  private ensureMap(): void {
    if (!this.running || this.mapInFlight) return;
    const wantedMapId = this.view.snapshot?.map_id ?? null;
    const loaded = this.view.map;
    const needed = loaded === null || (wantedMapId !== null && loaded.map_id !== wantedMapId);
    if (!needed) return;
    const now = this.scheduler.now();
    if (this.lastMapAttemptAt !== null && now - this.lastMapAttemptAt < this.mapRetryMs) return;
    this.lastMapAttemptAt = now;
    void this.loadMap();
  }

  private async loadMap(): Promise<void> {
    this.mapInFlight = true;
    const generation = this.generation;
    try {
      const map = await this.gateway.getMap({ signal: this.lifecycle?.signal });
      if (this.isCurrent(generation)) this.update({ map, mapError: null });
    } catch (error) {
      if (this.isCurrent(generation)) this.update({ mapError: describeError(error) });
    } finally {
      if (this.generation === generation) this.mapInFlight = false;
    }
  }

  // ---- журнал ----

  private async syncJournal(): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.running || this.journalInFlight || snapshot === null || snapshot.run_id === null) return;
    const journal = this.view.journal;
    const upToDate =
      !isActiveStatus(snapshot.status) && !journal.hasMore && journal.fetchedRevision === snapshot.revision;
    if (journal.runId !== snapshot.run_id || upToDate) return;

    const runId = snapshot.run_id;
    const generation = this.generation;
    const revision = snapshot.revision;
    this.journalInFlight = true;
    try {
      let hasMore = true;
      while (hasMore) {
        const current = this.view.journal;
        const page = await this.gateway.getJournalPage(runId, current.nextSequence, this.journalPageSize, {
          signal: this.lifecycle?.signal,
        });
        if (!this.isCurrent(generation) || this.view.journal.runId !== runId || page.run_id !== runId) return;
        const latest = this.view.journal;
        const progressed = page.next_sequence > latest.nextSequence;
        this.update({
          journal: {
            ...latest,
            entries: mergeJournalEntries(latest.entries, page.entries),
            nextSequence: Math.max(latest.nextSequence, page.next_sequence),
            hasMore: page.has_more,
            fetchedRevision: revision,
            error: null,
          },
        });
        hasMore = page.has_more && progressed;
      }
    } catch (error) {
      if (this.isCurrent(generation) && this.view.journal.runId === runId) {
        this.update({ journal: { ...this.view.journal, error: describeError(error) } });
      }
    } finally {
      if (this.generation === generation) this.journalInFlight = false;
    }
  }

  selectHypothesis(hypothesisId: string | null): void {
    this.update({ selectedHypothesisId: hypothesisId });
  }

  // ---- команды ----

  async startRun(seed: number, scenario: Scenario = "easy", missionText = "", mapMode: MapMode = "static"): Promise<void> {
    const snapshot = this.view.snapshot;
    if (snapshot === null || startDisabledReason(this.view) !== null) return;
    const requestId = this.generateId();
    this.pending = {
      kind: "start",
      requestId,
      startBody: {
        request_id: requestId,
        scenario,
        seed,
        ...(missionText.trim() === "" ? {} : { mission_text: missionText.trim() }),
        ...(mapMode === "static" ? {} : { map_mode: mapMode }),
      },
      baselineRunId: snapshot.run_id,
      stopRunId: null,
      sentAt: this.scheduler.now(),
      failedAtSeq: null,
    };
    await this.dispatchPending();
  }

  async stopRun(): Promise<void> {
    const snapshot = this.view.snapshot;
    if (snapshot === null || snapshot.run_id === null || stopDisabledReason(this.view) !== null) return;
    this.pending = {
      kind: "stop",
      requestId: this.generateId(),
      startBody: null,
      baselineRunId: snapshot.run_id,
      stopRunId: snapshot.run_id,
      sentAt: this.scheduler.now(),
      failedAtSeq: null,
    };
    await this.dispatchPending();
  }

  /** Повтор неопределённой команды с тем же request_id, только после сверки с /state. */
  async retryCommand(): Promise<void> {
    if (this.pending === null || this.view.command.phase !== "unknown" || !this.view.command.canRetry) return;
    this.pending.sentAt = this.scheduler.now();
    this.pending.failedAtSeq = null;
    await this.dispatchPending();
  }

  dismissCommandMessage(): void {
    if (this.view.command.phase === "failed") this.update({ command: IDLE_COMMAND });
  }

  private async dispatchPending(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return;
    const generation = this.generation;
    const seq = ++this.requestSeq;
    this.update({ command: { phase: "sending", kind: pending.kind, message: null, canRetry: false } });
    try {
      const options = { signal: this.lifecycle?.signal };
      const snapshot =
        pending.kind === "start" && pending.startBody !== null
          ? await this.gateway.startRun(pending.startBody, options)
          : await this.gateway.stopRun(pending.stopRunId ?? "", { request_id: pending.requestId }, options);
      if (!this.isCurrent(generation)) return;
      this.lastSuccessAt = this.scheduler.now();
      this.update({ connection: "live", connectionError: null });
      this.applySnapshot(snapshot, seq);
      if (this.pending === pending) {
        if (this.isConfirmed(pending, snapshot)) {
          this.pending = null;
          this.update({ command: IDLE_COMMAND });
        } else {
          this.update({
            command: { phase: "awaiting", kind: pending.kind, message: "Принято, ждём перехода состояния", canRetry: false },
          });
        }
      }
      void this.syncJournal();
    } catch (error) {
      if (!this.isCurrent(generation) || this.pending !== pending) return;
      if (isUnknownOutcome(error)) {
        pending.failedAtSeq = this.requestSeq;
        this.update({
          command: {
            phase: "unknown",
            kind: pending.kind,
            message: `Итог команды неизвестен (${describeError(error)}). Сверяем состояние…`,
            canRetry: false,
          },
        });
      } else {
        this.pending = null;
        this.update({
          command: { phase: "failed", kind: pending.kind, message: describeError(error), canRetry: false },
        });
      }
    }
  }

  private isConfirmed(pending: PendingCommand, snapshot: MissionSnapshot): boolean {
    if (pending.kind === "start") {
      return snapshot.run_id !== null && snapshot.run_id !== pending.baselineRunId && snapshot.status !== "idle";
    }
    return (
      snapshot.run_id !== pending.stopRunId || STOP_CONFIRMED_STATUSES.includes(snapshot.status)
    );
  }

  private reconcileCommand(snapshot: MissionSnapshot, seq: number): void {
    const pending = this.pending;
    const { command } = this.view;
    if (pending === null || command.phase === "sending" || command.phase === "idle" || command.phase === "failed") {
      return;
    }
    if (this.isConfirmed(pending, snapshot)) {
      this.pending = null;
      this.update({ command: IDLE_COMMAND });
      return;
    }
    if (command.phase === "unknown" && !command.canRetry && pending.failedAtSeq !== null && seq > pending.failedAtSeq) {
      this.update({
        command: {
          ...command,
          message: "Состояние сверено: команда не выполнена. Можно повторить с тем же request_id.",
          canRetry: true,
        },
      });
    }
  }

  // ---- экспорт ----

  async exportJournal(): Promise<JournalExport | null> {
    const runId = this.view.snapshot?.run_id ?? null;
    if (this.exportInFlight || !this.running) return null;
    if (runId === null) {
      this.update({ exportState: { phase: "failed", message: "Нет прогона для выгрузки" } });
      return null;
    }
    this.exportInFlight = true;
    const generation = this.generation;
    this.update({ exportState: { phase: "exporting", message: null } });
    try {
      const result = await exportFullJournal(this.gateway, runId, {
        signal: this.lifecycle?.signal,
        isCancelled: () => !this.isCurrent(generation) || this.view.snapshot?.run_id !== runId,
      });
      if (this.isCurrent(generation)) this.update({ exportState: { phase: "idle", message: null } });
      return this.isCurrent(generation) ? result : null;
    } catch (error) {
      if (!this.isCurrent(generation)) return null;
      const cancelled = error instanceof ExportCancelledError;
      this.update({
        exportState: {
          phase: cancelled ? "cancelled" : "failed",
          message: cancelled ? error.message : `Выгрузка не завершена: ${describeError(error)}. Файл не создан.`,
        },
      });
      return null;
    } finally {
      this.exportInFlight = false;
    }
  }
}
