import type { MissionGateway, RequestOptions, Scheduler } from "../src/application/ports";
import type {
  HealthStatus,
  JournalEntry,
  JournalPage,
  MapData,
  MissionSnapshot,
  StartRunRequest,
  StopRunRequest,
} from "../src/domain/contract";
import { parseJournalPage, parseMap, parseSnapshot } from "../src/domain/validation";
import journalExample from "../src/adapters/fixture/examples/journal.json";
import mapExample from "../src/adapters/fixture/examples/map.json";
import stateIdleExample from "../src/adapters/fixture/examples/state-idle.json";
import stateRunningExample from "../src/adapters/fixture/examples/state-running.json";

export const idle = (): MissionSnapshot => parseSnapshot(structuredClone(stateIdleExample));
export const running = (): MissionSnapshot => parseSnapshot(structuredClone(stateRunningExample));
export const exampleMap = (): MapData => parseMap(structuredClone(mapExample));
export const exampleJournal = (): JournalPage => parseJournalPage(structuredClone(journalExample));

export function snapshotWith(patch: Partial<MissionSnapshot>): MissionSnapshot {
  return { ...running(), ...patch };
}

export function entry(sequence: number, patch: Partial<JournalEntry> = {}): JournalEntry {
  return {
    sequence,
    simulation_time_s: sequence,
    kind: "observation",
    title: `Запись ${sequence}`,
    detail: "",
    hypothesis_id: null,
    expected: null,
    observed: null,
    conclusion: null,
    ...patch,
  };
}

export const readyHealth: HealthStatus = {
  status: "ready",
  ros_connected: true,
  judge_mode: "local",
  llm_available: true,
  supported_scenarios: ["easy", "medium", "hard"],
};

/** Виртуальные часы: время идёт только через advance. */
export class FakeScheduler implements Scheduler {
  private current = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + delayMs, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((first, second) => first[1].at - second[1].at)[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.current = Math.max(this.current, due[1].at);
      due[1].callback();
      await flush();
    }
    this.current = target;
    await flush();
  }
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

interface Call<T> {
  deferred: Deferred<T>;
  signal: AbortSignal | undefined;
}

/** Шлюз, где каждый ответ завершается вручную: позволяет проверять гонки и порядок. */
export class ControlledGateway implements MissionGateway {
  stateCalls: Array<Call<MissionSnapshot>> = [];
  healthCalls: Array<Call<HealthStatus>> = [];
  mapCalls: Array<Call<MapData>> = [];
  startCalls: Array<{ request: StartRunRequest } & Call<MissionSnapshot>> = [];
  stopCalls: Array<{ runId: string; request: StopRunRequest } & Call<MissionSnapshot>> = [];
  journalCalls: Array<{ runId: string; after: number } & Call<JournalPage>> = [];

  getState(options?: RequestOptions) {
    const call = { deferred: deferred<MissionSnapshot>(), signal: options?.signal };
    this.stateCalls.push(call);
    return call.deferred.promise;
  }

  getHealth(options?: RequestOptions) {
    const call = { deferred: deferred<HealthStatus>(), signal: options?.signal };
    this.healthCalls.push(call);
    return call.deferred.promise;
  }

  getMap(options?: RequestOptions) {
    const call = { deferred: deferred<MapData>(), signal: options?.signal };
    this.mapCalls.push(call);
    return call.deferred.promise;
  }

  startRun(request: StartRunRequest, options?: RequestOptions) {
    const call = { request, deferred: deferred<MissionSnapshot>(), signal: options?.signal };
    this.startCalls.push(call);
    return call.deferred.promise;
  }

  stopRun(runId: string, request: StopRunRequest, options?: RequestOptions) {
    const call = { runId, request, deferred: deferred<MissionSnapshot>(), signal: options?.signal };
    this.stopCalls.push(call);
    return call.deferred.promise;
  }

  getJournalPage(runId: string, after: number, _limit: number, options?: RequestOptions) {
    const call = { runId, after, deferred: deferred<JournalPage>(), signal: options?.signal };
    this.journalCalls.push(call);
    return call.deferred.promise;
  }
}
