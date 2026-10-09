import type { MapMode, MissionSnapshot, NavigationTarget, Scenario } from "../domain/contract"
import type { JournalExport } from "../domain/journal"
import type { MissionGateway, Scheduler } from "./ports"
import { CommandDispatcher } from "./session/commands"
import { JournalExportTask } from "./session/journalExportTask"
import { JournalSync } from "./session/journalSync"
import { MapLoading } from "./session/mapLoading"
import { ControllerSession, type SessionTiming } from "./session/session"
import { StatePolling } from "./session/statePolling"
import { EMPTY_JOURNAL, type MissionViewState } from "./viewState"

interface ControllerOptions {
  gateway: MissionGateway
  scheduler: Scheduler
  generateId: () => string
  pollIntervalMs?: number
  staleAfterMs?: number
  healthIntervalMs?: number
  mapRetryMs?: number
  journalPageSize?: number
  awaitTimeoutMs?: number
}

const DEFAULT_TIMING: SessionTiming = {
  pollIntervalMs: 500,
  staleAfterMs: 3000,
  healthIntervalMs: 2000,
  mapRetryMs: 2000,
  journalPageSize: 100,
  awaitTimeoutMs: 10000,
}

function timingFrom(options: ControllerOptions): SessionTiming {
  return {
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_TIMING.pollIntervalMs,
    staleAfterMs: options.staleAfterMs ?? DEFAULT_TIMING.staleAfterMs,
    healthIntervalMs: options.healthIntervalMs ?? DEFAULT_TIMING.healthIntervalMs,
    mapRetryMs: options.mapRetryMs ?? DEFAULT_TIMING.mapRetryMs,
    journalPageSize: options.journalPageSize ?? DEFAULT_TIMING.journalPageSize,
    awaitTimeoutMs: options.awaitTimeoutMs ?? DEFAULT_TIMING.awaitTimeoutMs,
  }
}

export class MissionController {
  private readonly session: ControllerSession
  private readonly polling: StatePolling
  private readonly mapLoading: MapLoading
  private readonly journal: JournalSync
  private readonly commands: CommandDispatcher
  private readonly exporter: JournalExportTask
  private lastAppliedSeq = 0

  constructor(options: ControllerOptions) {
    this.session = new ControllerSession(
      options.gateway,
      options.scheduler,
      timingFrom(options),
    )
    this.mapLoading = new MapLoading(this.session)
    this.journal = new JournalSync(this.session)
    this.exporter = new JournalExportTask(this.session)
    this.commands = new CommandDispatcher(this.session, {
      generateId: options.generateId,
      onSnapshot: (snapshot, seq, startBaselineRunId) =>
        this.applySnapshot(snapshot, seq, startBaselineRunId),
      onAccepted: () => void this.journal.sync(),
      onMapChanged: () => this.mapLoading.refresh(),
    })
    this.polling = new StatePolling(this.session, {
      onSnapshot: (snapshot, seq, requestedRunId) =>
        this.acceptSnapshot(snapshot, seq, requestedRunId),
      onTick: () => this.commands.checkAwaitTimeout(),
    })
  }

  subscribe = (listener: () => void): (() => void) => this.session.subscribe(listener)

  getView = (): MissionViewState => this.session.current

  start(): void {
    if (this.session.running) return
    this.session.begin()
    this.mapLoading.reset()
    this.journal.reset()
    this.polling.start()
    this.mapLoading.ensure()
  }

  dispose(): void {
    this.session.end()
  }

  selectHypothesis(hypothesisId: string | null): void {
    this.session.update({ selectedHypothesisId: hypothesisId })
  }

  startRun(
    seed: number,
    scenario: Scenario = "easy",
    missionText = "",
    mapMode: MapMode = "static",
    robotCount = 1,
    navigationTarget: NavigationTarget | null = null,
  ): Promise<void> {
    return this.commands.start({
      seed,
      scenario,
      missionText,
      mapMode,
      robotCount,
      navigationTarget,
    })
  }

  stopRun(): Promise<void> {
    return this.commands.stop()
  }

  retryCommand(): Promise<void> {
    return this.commands.retry()
  }

  dismissCommandMessage(): void {
    this.commands.dismiss()
  }

  exportJournal(): Promise<JournalExport | null> {
    return this.exporter.run()
  }

  private acceptSnapshot(
    snapshot: MissionSnapshot,
    seq: number,
    requestedRunId: string | null,
  ): void {
    this.session.markLive()
    const current = this.session.current.snapshot
    if (
      current !== null &&
      current.run_id !== requestedRunId &&
      snapshot.run_id === requestedRunId
    )
      return
    this.applySnapshot(snapshot, seq)
    this.mapLoading.ensure()
    void this.journal.sync()
  }

  private applySnapshot(
    snapshot: MissionSnapshot,
    seq: number,
    startBaselineRunId?: string | null,
  ): void {
    const previous = this.session.current.snapshot
    const acceptedStart =
      startBaselineRunId !== undefined &&
      previous?.run_id === startBaselineRunId &&
      snapshot.run_id !== null &&
      snapshot.run_id !== startBaselineRunId
    if (seq < this.lastAppliedSeq && !acceptedStart) return
    const outdated =
      previous !== null &&
      previous.run_id === snapshot.run_id &&
      snapshot.revision < previous.revision
    if (outdated) return
    this.lastAppliedSeq = Math.max(this.lastAppliedSeq, seq)
    const runChanged = previous?.run_id !== snapshot.run_id
    const previousJournal = this.session.current.journal
    const lastRunJournal =
      snapshot.run_id !== null && runChanged
        ? { ...EMPTY_JOURNAL, runId: snapshot.run_id }
        : previousJournal.runId === this.session.current.lastRunSnapshot?.run_id
          ? previousJournal
          : this.session.current.lastRunJournal
    const retainedRun = {
      lastRunSnapshot:
        snapshot.run_id === null ? (this.session.current.lastRunSnapshot ?? null) : snapshot,
      ...(lastRunJournal === undefined ? {} : { lastRunJournal }),
    }
    this.session.update(
      runChanged
        ? {
            ...retainedRun,
            snapshot,
            journal: { ...EMPTY_JOURNAL, runId: snapshot.run_id },
            selectedHypothesisId: null,
          }
        : { ...retainedRun, snapshot },
    )
    this.commands.reconcile(snapshot, seq)
  }
}
