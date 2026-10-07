import { ApiError, NetworkError } from "../../application/errors";
import type { MissionGateway } from "../../application/ports";
import type {
  HealthStatus,
  JournalEntry,
  JournalPage,
  MapData,
  MissionSnapshot,
  StartRunRequest,
  StopRunRequest,
} from "../../domain/contract";
import { isActiveStatus } from "../../domain/presentation";
import {
  buildScript,
  fixtureMap,
  idleSnapshot,
  OUTAGE_FRAME_INDEX,
  OUTAGE_REQUEST_COUNT,
  type FixtureScenarioName,
  type FixtureScript,
} from "./scenarios";

export interface FixtureControls {
  getScenario(): FixtureScenarioName;
  setScenario(name: FixtureScenarioName): void;
}

interface FixtureRun {
  runId: string;
  seed: number;
  scenario: FixtureScenarioName;
  script: FixtureScript;
  /** Индекс кадра, который будет выдан следующим запросом состояния. */
  nextFrame: number;
  revision: number;
  stopPhase: "none" | "requested" | "stopping" | "stopped";
  lastSnapshot: MissionSnapshot;
  extraEntries: Array<Omit<JournalEntry, "sequence">>;
  outageTriggered: boolean;
}

const FIXTURE_HEALTH: HealthStatus = {
  status: "ready",
  ros_connected: true,
  judge_mode: "local",
  llm_available: true,
  supported_scenarios: ["easy"],
  supported_map_modes: ["static"],
  supported_robot_counts: [1],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Демо-источник: воспроизводит сценарий по кадрам, один кадр на каждый запрос состояния. */
export class FixtureMissionGateway implements MissionGateway, FixtureControls {
  private scenario: FixtureScenarioName = "success";
  private runCounter = 0;
  private run: FixtureRun | null = null;
  private outageRemaining = 0;
  private startRejectionsLeft = 0;
  private readonly startedRequests = new Map<string, MissionSnapshot>();

  getScenario(): FixtureScenarioName {
    return this.scenario;
  }

  setScenario(name: FixtureScenarioName): void {
    this.scenario = name;
    this.startRejectionsLeft = name === "start_rejected" ? 1 : 0;
  }

  async getHealth(): Promise<HealthStatus> {
    return clone(FIXTURE_HEALTH);
  }

  async getMap(): Promise<MapData> {
    return clone(fixtureMap);
  }

  async getState(): Promise<MissionSnapshot> {
    const run = this.run;
    if (run === null) return clone(idleSnapshot);
    if (this.outageRemaining > 0) {
      this.outageRemaining -= 1;
      throw new NetworkError("Демо: имитация разрыва связи с backend");
    }
    if (run.scenario === "disconnect" && !run.outageTriggered && run.nextFrame === OUTAGE_FRAME_INDEX) {
      run.outageTriggered = true;
      this.outageRemaining = OUTAGE_REQUEST_COUNT - 1;
      throw new NetworkError("Демо: имитация разрыва связи с backend");
    }
    return clone(this.nextSnapshot(run));
  }

  private nextSnapshot(run: FixtureRun): MissionSnapshot {
    if (run.stopPhase === "requested") {
      run.stopPhase = "stopping";
      return this.emit(run, { ...run.lastSnapshot, status: "stopping" });
    }
    if (run.stopPhase === "stopping" || run.stopPhase === "stopped") {
      run.stopPhase = "stopped";
      return this.emit(run, { ...run.lastSnapshot, status: "stopped", current_goal: null, planned_path: [] }, true);
    }
    const frame = run.script.frames[Math.min(run.nextFrame, run.script.frames.length - 1)];
    if (frame === undefined) return run.lastSnapshot;
    const atEnd = run.nextFrame >= run.script.frames.length - 1;
    if (!atEnd) run.nextFrame += 1;
    return this.emit(run, frame, atEnd);
  }

  private emit(run: FixtureRun, frame: MissionSnapshot, repeat = false): MissionSnapshot {
    if (!repeat || run.lastSnapshot.status !== frame.status) run.revision += 1;
    const snapshot: MissionSnapshot = {
      ...frame,
      run_id: run.runId,
      revision: run.revision,
      scenario: "easy",
      seed: run.seed,
    };
    run.lastSnapshot = snapshot;
    return snapshot;
  }

  async startRun(request: StartRunRequest): Promise<MissionSnapshot> {
    const known = this.startedRequests.get(request.request_id);
    if (known !== undefined) return clone(known);
    if (!Number.isInteger(request.seed)) {
      throw new ApiError(422, "invalid_request", "seed должен быть целым числом", false);
    }
    if (this.startRejectionsLeft > 0) {
      this.startRejectionsLeft -= 1;
      throw new ApiError(503, "environment_not_ready", "Ожидаются наблюдения ROS.", true);
    }
    if (this.run !== null && isActiveStatus(this.run.lastSnapshot.status)) {
      throw new ApiError(409, "run_active", "Другой прогон уже выполняется.", false);
    }
    this.runCounter += 1;
    const script = buildScript(this.scenario);
    this.run = {
      runId: `fixture-run-${String(this.runCounter).padStart(3, "0")}`,
      seed: request.seed,
      scenario: this.scenario,
      script,
      nextFrame: 0,
      revision: 0,
      stopPhase: "none",
      lastSnapshot: clone(idleSnapshot),
      extraEntries: [],
      outageTriggered: false,
    };
    const snapshot = this.nextSnapshot(this.run);
    this.startedRequests.set(request.request_id, snapshot);
    return clone(snapshot);
  }

  async stopRun(runId: string, _request: StopRunRequest): Promise<MissionSnapshot> {
    const run = this.run;
    if (run === null || run.runId !== runId) {
      throw new ApiError(run === null ? 404 : 409, "run_not_current", "Это не текущий прогон.", false);
    }
    if (isActiveStatus(run.lastSnapshot.status) && run.stopPhase === "none") {
      run.stopPhase = "requested";
      run.extraEntries.push({
        simulation_time_s: run.lastSnapshot.simulation_time_s,
        kind: "decision",
        title: "Остановка по запросу пользователя",
        detail: "Исполнитель прерывает миссию; успех возврата не засчитывается.",
        hypothesis_id: null,
        expected: null,
        observed: null,
        conclusion: null,
        experiment_id: null,
        detection_id: null,
        plan_id: null,
        evidence: [],
      });
    }
    return clone(run.lastSnapshot);
  }

  async getJournalPage(runId: string, afterSequence: number, limit: number): Promise<JournalPage> {
    const run = this.run;
    if (run === null || run.runId !== runId) {
      throw new ApiError(404, "run_not_found", "Неизвестный прогон.", false);
    }
    if (!Number.isInteger(afterSequence) || afterSequence < 0 || limit < 1 || limit > 200) {
      throw new ApiError(422, "invalid_params", "Неверные параметры журнала.", false);
    }
    const deliveredFrame = run.nextFrame - 1;
    const scripted = run.script.journal
      .filter((item) => item.atFrame <= deliveredFrame)
      .map((item) => item.entry);
    const extras = run.extraEntries;
    const all: JournalEntry[] = [...scripted, ...extras].map((entry, index) => ({ ...entry, sequence: index + 1 }));
    const matching = all.filter((entry) => entry.sequence > afterSequence);
    const entries = matching.slice(0, limit);
    const last = entries[entries.length - 1];
    return {
      run_id: runId,
      entries: clone(entries),
      next_sequence: last === undefined ? afterSequence : last.sequence,
      has_more: matching.length > entries.length,
    };
  }
}
