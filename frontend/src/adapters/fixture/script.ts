import type { HealthStatus, MapData, MissionSnapshot } from "../../domain/contract"
import type { JournalContent } from "./content"

export interface ScriptedJournalEntry {
  atFrame: number
  entry: JournalContent
}

export interface MapRevision {
  fromFrame: number
  map: MapData | null
}

interface OutagePlan {
  atFrame: number
  requests: number
}

export interface GatewayBehavior {
  startRejections: number
  stopTimeouts: number
  outage: OutagePlan | null
  journalFailureAtFrame: number | null
  exportFailures: number
  slowExport: boolean
}

export interface FixtureScript {
  idle: MissionSnapshot
  frames: MissionSnapshot[]
  journal: ScriptedJournalEntry[]
  health: HealthStatus[]
  maps: MapRevision[]
  behavior: GatewayBehavior
}

export const IDLE_FRAME_INDEX = -1

export function mapAt(script: FixtureScript, frameIndex: number): MapData | null {
  let current: MapData | null = null
  for (const revision of script.maps) {
    if (revision.fromFrame <= frameIndex) current = revision.map
  }
  return current
}

export function healthAt(script: FixtureScript, callIndex: number): HealthStatus | null {
  const lastIndex = script.health.length - 1
  return script.health[Math.min(Math.max(callIndex, 0), lastIndex)] ?? null
}
