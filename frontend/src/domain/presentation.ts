import type {
  GoalKind,
  JudgeMode,
  MapData,
  MissionSnapshot,
  PlannerMode,
  RunStatus,
  SensorFault,
  SensorState,
  StepStatus,
  TerrainEstimate,
} from "./contract";
import { ACTIVE_STATUSES, FINISHED_STATUSES } from "./contract";

export type StatusTone = "neutral" | "active" | "success" | "warning" | "danger";

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: "Ожидание запуска",
  starting: "Запуск",
  running: "Выполняется",
  returning: "Возврат на базу",
  stopping: "Остановка",
  completed: "Завершено успешно",
  stopped: "Прервано пользователем",
  failed: "Завершено с ошибкой",
};

const STATUS_TONES: Record<RunStatus, StatusTone> = {
  idle: "neutral",
  starting: "active",
  running: "active",
  returning: "active",
  stopping: "warning",
  completed: "success",
  stopped: "warning",
  failed: "danger",
};

const STATUS_MARKS: Record<RunStatus, string> = {
  idle: "○",
  starting: "◔",
  running: "▶",
  returning: "↩",
  stopping: "■…",
  completed: "✔",
  stopped: "■",
  failed: "✖",
};

const GOAL_LABELS: Record<GoalKind, string> = {
  explore: "Исследование",
  approach: "Сближение с образцом",
  collect: "Сбор образца",
  return: "Возврат на базу",
};

export function statusLabel(status: RunStatus): string {
  return STATUS_LABELS[status];
}

export function statusTone(status: RunStatus): StatusTone {
  return STATUS_TONES[status];
}

export function statusMark(status: RunStatus): string {
  return STATUS_MARKS[status];
}

export function goalLabel(kind: GoalKind): string {
  return GOAL_LABELS[kind];
}

export function judgeLabel(mode: JudgeMode): string {
  return mode === "local" ? "Судья: local (допущения проекта)" : "Судья: official";
}

export function plannerLabel(mode: PlannerMode): string {
  return mode === "llm" ? "Планировщик: llm" : "Планировщик: fallback (алгоритм)";
}

export function isActiveStatus(status: RunStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isFinishedStatus(status: RunStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/** Новый прогон можно запускать из ожидания или после терминального состояния. */
export function isStartableStatus(status: RunStatus): boolean {
  return status === "idle" || isFinishedStatus(status);
}

export const NO_DATA = "нет данных";

export function formatNumber(value: number | null, fractionDigits = 1, unit = ""): string {
  if (value === null) return NO_DATA;
  const text = value.toFixed(fractionDigits);
  return unit ? `${text} ${unit}` : text;
}

export const BATTERY_UNIT = "усл. ед.";

/** Батарея всегда в условных единицах, не в процентах. */
export function formatBattery(remaining: number | null, initial: number): string {
  if (remaining === null) return `${NO_DATA} (из ${initial} ${BATTERY_UNIT})`;
  return `${remaining.toFixed(1)} из ${initial} ${BATTERY_UNIT}`;
}

export function batteryRatio(remaining: number | null, initial: number): number | null {
  if (remaining === null) return null;
  return Math.min(Math.max(remaining / initial, 0), 1);
}

export function formatSimulationTime(seconds: number | null): string {
  return formatNumber(seconds, 1, "с");
}

export function formatSampleSignal(signal: number | null): string {
  return formatNumber(signal, 2);
}

export function formatReturnEstimate(estimate: number | null): string {
  return formatNumber(estimate, 1, BATTERY_UNIT);
}

export function formatTerrainEstimate(estimate: TerrainEstimate): string {
  return `оценка агента: ${estimate.energy_per_m.toFixed(1)} ${BATTERY_UNIT}/м, confidence ${estimate.confidence.toFixed(2)}`;
}

export function isMapMismatch(snapshot: MissionSnapshot | null, map: MapData | null): boolean {
  if (snapshot === null || snapshot.map_id === null) return false;
  return map === null || map.map_id !== snapshot.map_id;
}

export type OutcomeKind = "none" | "success" | "interrupted" | "failure";

/** Успех показывается только по статусу completed. */
export function outcomeKind(status: RunStatus): OutcomeKind {
  switch (status) {
    case "completed":
      return "success";
    case "stopped":
      return "interrupted";
    case "failed":
      return "failure";
    default:
      return "none";
  }
}

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: "ожидает",
  active: "выполняется",
  done: "выполнен",
  rejected: "отклонён проверкой",
  dropped: "снят при пересмотре",
};

const SENSOR_LABELS: Record<SensorState, string> = {
  ok: "в норме",
  suspected: "подозрение на неисправность",
  degraded: "неисправен",
  recovering: "восстанавливается",
};

const SENSOR_FAULT_LABELS: Record<SensorFault, string> = {
  noise: "шум",
  stuck: "залипание",
  dropout: "нет сообщений",
};

const HYPOTHESIS_STATUS_LABELS: Record<string, string> = {
  proposed: "предложена",
  testing: "проверяется",
  confirmed: "подтверждается измерениями",
  refuted: "опровергнута",
  deferred: "отложена",
  unverified: "недостаточно данных",
};

export function stepStatusLabel(status: StepStatus): string {
  return STEP_STATUS_LABELS[status];
}

export function sensorLabel(state: SensorState, fault: SensorFault | null): string {
  return fault === null ? SENSOR_LABELS[state] : `${SENSOR_LABELS[state]} (${SENSOR_FAULT_LABELS[fault]})`;
}

export function sensorTone(state: SensorState): StatusTone {
  return state === "ok" ? "success" : state === "degraded" ? "danger" : "warning";
}

export function hypothesisStatusLabel(status: string): string {
  return HYPOTHESIS_STATUS_LABELS[status] ?? status;
}

/** Подпись оценки грунта: значение и неопределённость, если backend её передал. */
export function terrainLabel(estimate: TerrainEstimate): string {
  const spread = estimate.std_energy_per_m === null ? "" : `±${estimate.std_energy_per_m.toFixed(1)}`;
  const regime = estimate.regime > 0 ? ` · режим ${estimate.regime}` : "";
  return `${estimate.energy_per_m.toFixed(1)}${spread}/м${regime}`;
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Подписи без наложения: подпись, пересекающая уже размещённую, пропускается. */
export function placeLabels<T extends LabelBox>(labels: readonly T[]): T[] {
  const placed: T[] = [];
  for (const label of labels) {
    const overlaps = placed.some(
      (other) =>
        label.x < other.x + other.width &&
        other.x < label.x + label.width &&
        label.y < other.y + other.height &&
        other.y < label.y + label.height,
    );
    if (!overlaps) placed.push(label);
  }
  return placed;
}
