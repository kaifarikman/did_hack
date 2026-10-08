import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  type MapData,
  type MissionSnapshot,
  type RunStatus,
} from "./contract"

export type OutcomeKind = "none" | "success" | "interrupted" | "failure"

const OUTCOME_BY_STATUS: Partial<Readonly<Record<RunStatus, OutcomeKind>>> = {
  completed: "success",
  stopped: "interrupted",
  failed: "failure",
}

export function isActiveStatus(status: RunStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

export function isFinishedStatus(status: RunStatus): boolean {
  return FINISHED_STATUSES.includes(status)
}

export function isStartableStatus(status: RunStatus): boolean {
  return status === "idle" || isFinishedStatus(status)
}

export function isMapMismatch(snapshot: MissionSnapshot | null, map: MapData | null): boolean {
  if (snapshot === null || snapshot.map_id === null) return false
  return map === null || map.map_id !== snapshot.map_id
}

export function outcomeKind(status: RunStatus): OutcomeKind {
  return OUTCOME_BY_STATUS[status] ?? "none"
}
