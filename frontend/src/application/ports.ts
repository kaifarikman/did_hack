import type {
  HealthStatus,
  JournalPage,
  MapData,
  MissionSnapshot,
  StartRunRequest,
  StopRunRequest,
} from "../domain/contract";

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Единый доступ к миссии: HTTP backend или демо-данные. */
export interface MissionGateway {
  getHealth(options?: RequestOptions): Promise<HealthStatus>;
  getState(options?: RequestOptions): Promise<MissionSnapshot>;
  getMap(options?: RequestOptions): Promise<MapData>;
  startRun(request: StartRunRequest, options?: RequestOptions): Promise<MissionSnapshot>;
  stopRun(runId: string, request: StopRunRequest, options?: RequestOptions): Promise<MissionSnapshot>;
  getJournalPage(
    runId: string,
    afterSequence: number,
    limit: number,
    options?: RequestOptions,
  ): Promise<JournalPage>;
}

/** Монотонные часы и отложенный вызов; возвращает функцию отмены. */
export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): () => void;
}
