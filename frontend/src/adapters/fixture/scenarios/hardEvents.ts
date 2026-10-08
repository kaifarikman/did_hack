import type {
  HazardView,
  HypothesisView,
  MissionSnapshot,
  ResearchView,
  SensorFault,
  SensorState,
} from "../../../domain/contract"
import { scriptOf, timed } from "../baseline"
import { hypothesesFrom, journalEntryFrom } from "../content"
import content from "../examples/scenarios/hardEvents.json"
import { point } from "../route"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

interface SensorPhase {
  from: number
  state: SensorState
  fault: SensorFault | null
}

const QUALITY: Record<SensorState, number> = {
  ok: 1,
  suspected: 0.7,
  degraded: 0.3,
  recovering: 0.6,
}
const FAULT_STARTS: ReadonlyArray<[SensorFault, number]> = [
  ["noise", 8],
  ["stuck", 30],
  ["dropout", 44],
]
const SENSOR_PHASES: SensorPhase[] = FAULT_STARTS.flatMap(([fault, start]) => [
  { from: start, state: "suspected", fault },
  { from: start + 2, state: "degraded", fault },
  { from: start + 5, state: "recovering", fault },
  { from: start + 7, state: "ok", fault: null },
])
const HAZARD_ONE_HITS: ReadonlyArray<[number, number]> = [
  [12, 1],
  [16, 2],
  [49, 3],
]
const HAZARD_TWO_FROM = 25
const HAZARD_HYPOTHESIS_FROM = 13
const HAZARD_VERDICT_AT = 20
const [HAZARD_TESTING, HAZARD_UNVERIFIED] = hypothesesFrom([
  content.hypotheses.hazardTesting,
  content.hypotheses.hazardUnverified,
])

export function sensorAt(index: number): ResearchView["sensor"] {
  const phase = SENSOR_PHASES.filter((item) => item.from <= index).at(-1)
  const state = phase?.state ?? "ok"
  return { state, fault: phase?.fault ?? null, quality: QUALITY[state] }
}

function hazardsAt(index: number): HazardView[] {
  const hits = HAZARD_ONE_HITS.filter(([from]) => from <= index).at(-1)?.[1] ?? 0
  const first: HazardView[] =
    hits === 0
      ? []
      : [{ detection_id: "hazard-1", center: point(-1.2, -0.5), radius_m: 0.35, hits }]
  const second: HazardView[] =
    index >= HAZARD_TWO_FROM
      ? [{ detection_id: "hazard-2", center: point(-0.25, -0.1), radius_m: 0.3, hits: 1 }]
      : []
  return [...first, ...second]
}

function hazardHypothesis(index: number): HypothesisView[] {
  if (index >= HAZARD_VERDICT_AT && HAZARD_UNVERIFIED !== undefined) return [HAZARD_UNVERIFIED]
  if (index >= HAZARD_HYPOTHESIS_FROM && HAZARD_TESTING !== undefined) return [HAZARD_TESTING]
  return []
}

function harden(frame: MissionSnapshot, index: number): MissionSnapshot {
  if (frame.research === null) return { ...frame, scenario: "hard" }
  const sensor = sensorAt(index)
  const replanned = index >= 12
  const silent = sensor.fault === "dropout" && sensor.state !== "ok"
  return {
    ...frame,
    scenario: "hard",
    sample_signal: silent ? null : frame.sample_signal,
    research: {
      ...frame.research,
      sensor,
      hazards: hazardsAt(index),
      hypotheses: [...frame.research.hypotheses, ...hazardHypothesis(index)],
      last_replan_reason: replanned ? content.replanReason : null,
      last_replan_detection_id: replanned ? "hazard-1" : null,
    },
  }
}

export function buildHardEvents(): FixtureScript {
  const mission = standardMission({ timeline: { batteryInitial: 20, reserveMargin: 2.5 } })
  const frames = mission.frames.map(harden)
  const lowBatteryAt = frames.findIndex(
    (frame) =>
      frame.battery_remaining !== null &&
      frame.return_energy_estimate !== null &&
      frame.battery_remaining < frame.return_energy_estimate,
  )
  const J = content.journal
  return scriptOf(frames, [
    ...mission.journal,
    timed(10, journalEntryFrom(J.noise)),
    timed(12, journalEntryFrom(J.hazard)),
    timed(12, journalEntryFrom(J.hazardReplan)),
    timed(HAZARD_VERDICT_AT, journalEntryFrom(J.hazardVerdict)),
    timed(32, journalEntryFrom(J.stuck)),
    timed(46, journalEntryFrom(J.dropout)),
    ...(lowBatteryAt > 0 ? [timed(lowBatteryAt, journalEntryFrom(J.lowBattery))] : []),
  ])
}
