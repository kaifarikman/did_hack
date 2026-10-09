import type {
  GoalKind,
  PlannerMode,
  SensorFault,
  SensorState,
  TerrainEstimate,
} from "@/domain/contract"
import type { Message, MessageKey } from "@/domain/message"
import type { Formatters } from "@/ui/shared/i18n"

type ResearchKey = Extract<MessageKey, `research:${string}`>
type ResearchMessage = Message
type ResearchFormatters = Pick<Formatters, "number">

type SensorTone = "positive" | "attention" | "critical"

export const PLAN_SOURCE_LABELS: Readonly<Record<PlannerMode, ResearchKey>> = {
  llm: "research:source.llm",
  fallback: "research:source.fallback",
}

export const STEP_GOAL_LABELS: Readonly<Record<GoalKind, ResearchKey>> = {
  explore: "research:goal.explore",
  approach: "research:goal.approach",
  collect: "research:goal.collect",
  return: "research:goal.return",
}

export const SENSOR_STATE_LABELS: Readonly<Record<SensorState, ResearchKey>> = {
  ok: "research:sensor.ok",
  suspected: "research:sensor.suspected",
  degraded: "research:sensor.degraded",
  recovering: "research:sensor.recovering",
}

const SENSOR_TONES: Readonly<Record<SensorState, SensorTone>> = {
  ok: "positive",
  suspected: "attention",
  degraded: "critical",
  recovering: "attention",
}

export const SENSOR_FAULT_LABELS: Readonly<Record<SensorFault, ResearchKey>> = {
  noise: "research:fault.noise",
  stuck: "research:fault.stuck",
  dropout: "research:fault.dropout",
}

export const HYPOTHESIS_STATUSES = [
  "proposed",
  "testing",
  "confirmed",
  "refuted",
  "deferred",
  "unverified",
] as const
type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number]

export const HYPOTHESIS_STATUS_LABELS: Readonly<Record<HypothesisStatus, ResearchKey>> = {
  proposed: "research:hypothesis.proposed",
  testing: "research:hypothesis.testing",
  confirmed: "research:hypothesis.confirmed",
  refuted: "research:hypothesis.refuted",
  deferred: "research:hypothesis.deferred",
  unverified: "research:hypothesis.unverified",
}

export const HYPOTHESIS_KINDS = ["costly_terrain", "terrain_change", "sample_signal"] as const
type HypothesisKind = (typeof HYPOTHESIS_KINDS)[number]

export const HYPOTHESIS_KIND_LABELS: Readonly<Record<HypothesisKind, ResearchKey>> = {
  sample_signal: "research:hypothesisKind.sampleSignal",
  costly_terrain: "research:hypothesisKind.costlyTerrain",
  terrain_change: "research:hypothesisKind.terrainChange",
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

export function hypothesisStatusMessage(status: string): ResearchMessage {
  if (isOneOf(HYPOTHESIS_STATUSES, status)) return { key: HYPOTHESIS_STATUS_LABELS[status] }
  return { key: "research:hypothesis.unknown", params: { status } }
}

export function hypothesisKindMessage(kind: string): ResearchMessage {
  if (isOneOf(HYPOTHESIS_KINDS, kind)) return { key: HYPOTHESIS_KIND_LABELS[kind] }
  return { key: "research:hypothesisKind.unknown", params: { kind } }
}

interface SensorLabels {
  readonly state: ResearchKey
  readonly fault: ResearchKey | null
  readonly tone: SensorTone
}

export function sensorLabels(state: SensorState, fault: SensorFault | null): SensorLabels {
  return {
    state: SENSOR_STATE_LABELS[state],
    fault: fault === null ? null : SENSOR_FAULT_LABELS[fault],
    tone: SENSOR_TONES[state],
  }
}

export function terrainMessage(
  estimate: TerrainEstimate,
  format: ResearchFormatters,
): ResearchMessage {
  const energy = format.number(estimate.energy_per_m, 1)
  if (estimate.std_energy_per_m === null)
    return { key: "research:terrain.value", params: { energy } }
  return {
    key: "research:terrain.valueSpread",
    params: { energy, spread: format.number(estimate.std_energy_per_m, 1) },
  }
}
