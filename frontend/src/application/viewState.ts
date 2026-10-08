import type { JournalEntry, MapData, MissionSnapshot, HealthStatus } from "../domain/contract";
import { isStartableStatus, isActiveStatus } from "../domain/presentation";

export type ConnectionState = "connecting" | "live" | "stale";

export interface JournalState {
  runId: string | null;
  entries: JournalEntry[];
  nextSequence: number;
  hasMore: boolean;
  fetchedRevision: number | null;
  error: string | null;
}

export type CommandPhase = "idle" | "sending" | "awaiting" | "unknown" | "failed";

export interface CommandState {
  phase: CommandPhase;
  kind: "start" | "stop" | null;
  message: string | null;
  /** Повтор с тем же request_id разрешён только после сверки с /state. */
  canRetry: boolean;
}

export type ExportPhase = "idle" | "exporting" | "failed" | "cancelled";

export interface ExportState {
  phase: ExportPhase;
  message: string | null;
}

export interface MissionViewState {
  health: HealthStatus | null;
  snapshot: MissionSnapshot | null;
  map: MapData | null;
  mapError: string | null;
  connection: ConnectionState;
  connectionError: string | null;
  journal: JournalState;
  selectedHypothesisId: string | null;
  command: CommandState;
  exportState: ExportState;
}

export const IDLE_COMMAND: CommandState = { phase: "idle", kind: null, message: null, canRetry: false };

function commandBusy(command: CommandState): boolean {
  return command.phase === "sending" || command.phase === "awaiting" || command.phase === "unknown";
}

/** Причина, по которой Start недоступен, либо null. */
export function startDisabledReason(view: MissionViewState): string | null {
  if (view.snapshot === null) return "Нет данных о состоянии миссии";
  if (view.connection !== "live") return "Нет актуальной связи с backend";
  if (view.health === null) return "Готовность среды неизвестна";
  if (view.health.status !== "ready") return "Среда ещё запускается";
  if (commandBusy(view.command)) return "Команда уже отправлена";
  if (!isStartableStatus(view.snapshot.status)) return "Прогон уже выполняется";
  return null;
}

/** Дополнительные условия запуска навигации: возможность объявляет сам backend. */
export function navigationStartDisabledReason(view: MissionViewState): string | null {
  if (view.health === null) return "Готовность среды неизвестна";
  if (!view.health.supported_task_types.includes("navigation")) {
    return "Backend не объявляет поддержку навигации к точке";
  }
  if (!view.health.supported_scenarios.includes("easy")) return "Профиль easy недоступен в среде";
  if (!view.health.supported_map_modes.includes("static")) return "Готовая карта (static) недоступна в среде";
  if (!view.health.supported_robot_counts.includes(1)) return "Запуск одного робота недоступен в среде";
  return null;
}

export function stopDisabledReason(view: MissionViewState): string | null {
  if (view.snapshot === null || view.snapshot.run_id === null) return "Нет активного прогона";
  if (view.connection !== "live") return "Нет актуальной связи с backend";
  if (commandBusy(view.command)) return "Команда уже отправлена";
  if (!isActiveStatus(view.snapshot.status)) return "Прогон не выполняется";
  if (view.snapshot.status === "stopping") return "Остановка уже идёт";
  return null;
}
