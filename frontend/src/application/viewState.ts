import type { HealthStatus, JournalEntry, MapData, MissionSnapshot } from "../domain/contract"
import type { Message } from "../domain/message"
import { isActiveStatus, isStartableStatus } from "../domain/status"

export type ConnectionState = "connecting" | "live" | "stale"

export interface JournalState {
  runId: string | null
  entries: JournalEntry[]
  nextSequence: number
  hasMore: boolean
  fetchedRevision: number | null
  error: Message | null
}

export type CommandPhase = "idle" | "sending" | "awaiting" | "unknown" | "failed"

export type CommandKind = "start" | "stop"

export interface CommandState {
  phase: CommandPhase
  kind: CommandKind | null
  message: Message | null
  cause: Message | null
  canRetry: boolean
}

export type ExportPhase = "idle" | "exporting" | "failed" | "cancelled"

export interface ExportState {
  phase: ExportPhase
  message: Message | null
  cause: Message | null
}

export interface MissionViewState {
  health: HealthStatus | null
  snapshot: MissionSnapshot | null
  lastRunSnapshot?: MissionSnapshot | null
  lastRunJournal?: JournalState
  map: MapData | null
  mapError: Message | null
  connection: ConnectionState
  connectionError: Message | null
  journal: JournalState
  selectedHypothesisId: string | null
  command: CommandState
  exportState: ExportState
}

export type StartBlocker =
  | "no_snapshot"
  | "offline"
  | "health_unknown"
  | "environment_starting"
  | "command_busy"
  | "run_active"

export type StopBlocker =
  | "no_run"
  | "offline"
  | "command_busy"
  | "run_inactive"
  | "already_stopping"

export const START_BLOCKERS: readonly StartBlocker[] = [
  "no_snapshot",
  "offline",
  "health_unknown",
  "environment_starting",
  "command_busy",
  "run_active",
]

export const STOP_BLOCKERS: readonly StopBlocker[] = [
  "no_run",
  "offline",
  "command_busy",
  "run_inactive",
  "already_stopping",
]

export const IDLE_COMMAND: CommandState = {
  phase: "idle",
  kind: null,
  message: null,
  cause: null,
  canRetry: false,
}

export const IDLE_EXPORT: ExportState = { phase: "idle", message: null, cause: null }

export const EMPTY_JOURNAL: JournalState = {
  runId: null,
  entries: [],
  nextSequence: 0,
  hasMore: false,
  fetchedRevision: null,
  error: null,
}

export const INITIAL_VIEW: MissionViewState = {
  health: null,
  snapshot: null,
  map: null,
  mapError: null,
  connection: "connecting",
  connectionError: null,
  journal: EMPTY_JOURNAL,
  selectedHypothesisId: null,
  command: IDLE_COMMAND,
  exportState: IDLE_EXPORT,
}

export function isCommandBusy(command: CommandState): boolean {
  return (
    command.phase === "sending" || command.phase === "awaiting" || command.phase === "unknown"
  )
}

export function startDisabledReason(view: MissionViewState): StartBlocker | null {
  if (view.snapshot === null) return "no_snapshot"
  if (view.connection !== "live") return "offline"
  if (view.health === null) return "health_unknown"
  if (view.health.status !== "ready") return "environment_starting"
  if (isCommandBusy(view.command)) return "command_busy"
  if (!isStartableStatus(view.snapshot.status)) return "run_active"
  return null
}

export function stopDisabledReason(view: MissionViewState): StopBlocker | null {
  if (view.snapshot === null || view.snapshot.run_id === null) return "no_run"
  if (view.connection !== "live") return "offline"
  if (isCommandBusy(view.command)) return "command_busy"
  if (!isActiveStatus(view.snapshot.status)) return "run_inactive"
  if (view.snapshot.status === "stopping") return "already_stopping"
  return null
}

export function showStopAction(view: MissionViewState): boolean {
  return (
    (view.snapshot !== null &&
      view.snapshot.run_id !== null &&
      isActiveStatus(view.snapshot.status)) ||
    (view.command.kind === "stop" && isCommandBusy(view.command))
  )
}

export type ConnectionStatus = ConnectionState | "offline"

export function connectionStatus(view: MissionViewState): ConnectionStatus {
  if (view.connection !== "stale") return view.connection
  return view.snapshot === null ? "offline" : "stale"
}
