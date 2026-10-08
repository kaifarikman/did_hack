import type {
  ErrorInfo,
  GoalKind,
  HealthStatus,
  MapData,
  MissionSnapshot,
  Point,
} from "../../domain/contract"
import { parseJournalPage, parseMap, parseSnapshot } from "../../domain/validation"
import { errorFrom, type JournalContent, journalEntryFrom } from "./content"
import missionContent from "./examples/content/mission.json"
import journalExample from "./examples/journal.json"
import mapExample from "./examples/map.json"
import stateIdleExample from "./examples/state-idle.json"
import stateRunningExample from "./examples/state-running.json"
import { point } from "./route"
import type { FixtureScript, GatewayBehavior, ScriptedJournalEntry } from "./script"

export const idleSnapshot: MissionSnapshot = parseSnapshot(stateIdleExample)
export const fixtureMap: MapData = parseMap(mapExample)
export const runningTemplate: MissionSnapshot = parseSnapshot(stateRunningExample)

export const BASE: Point = point(-2, -0.5)
export const SAMPLE_PLACE: Point = point(-0.25, 0.25)
export const TERRAIN_CENTER: Point = point(-1.7, -0.5)
export const MISSION_TEXT: string = missionContent.missionText
export const GOAL_REASONS: Readonly<Record<GoalKind, string>> = missionContent.goalReasons

type MissionErrorName = keyof typeof missionContent.errors
type MissionJournalName = keyof typeof missionContent.journal

export function missionError(name: MissionErrorName): ErrorInfo {
  return errorFrom(missionContent.errors[name])
}

export function missionEntry(name: MissionJournalName): JournalContent {
  return journalEntryFrom(missionContent.journal[name])
}

export const exampleEntries: JournalContent[] = parseJournalPage(journalExample).entries.map(
  ({ sequence: _sequence, ...rest }) => rest,
)

export const READY_HEALTH: HealthStatus = {
  status: "ready",
  ros_connected: true,
  judge_mode: "local",
  llm_available: true,
  supported_scenarios: ["easy", "medium", "hard"],
  supported_map_modes: ["static", "slam"],
  supported_robot_counts: [1, 2],
}

export const DEFAULT_BEHAVIOR: GatewayBehavior = {
  startRejections: 0,
  stopTimeouts: 0,
  outage: null,
  journalFailureAtFrame: null,
  exportFailures: 0,
  slowExport: false,
}

export function timed(frame: number, entry: JournalContent): ScriptedJournalEntry {
  return { atFrame: frame, entry: { ...entry, simulation_time_s: frame } }
}

export function sortJournal(entries: ScriptedJournalEntry[]): ScriptedJournalEntry[] {
  return [...entries].sort((first, second) => first.atFrame - second.atFrame)
}

export function scriptOf(
  frames: MissionSnapshot[],
  journal: ScriptedJournalEntry[],
  patch: Partial<FixtureScript> = {},
): FixtureScript {
  return {
    idle: idleSnapshot,
    frames,
    journal: sortJournal(journal),
    health: [READY_HEALTH],
    maps: [{ fromFrame: -1, map: fixtureMap }],
    behavior: DEFAULT_BEHAVIOR,
    ...patch,
  }
}
