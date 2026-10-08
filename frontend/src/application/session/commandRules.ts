import type {
  MapMode,
  MissionSnapshot,
  RunStatus,
  Scenario,
  StartRunRequest,
} from "../../domain/contract"
import type { Message } from "../../domain/message"
import type { CommandKind, CommandState } from "../viewState"

export interface PendingCommand {
  readonly kind: CommandKind
  readonly requestId: string
  readonly startBody: StartRunRequest | null
  readonly baselineRunId: string | null
  readonly stopRunId: string | null
  sentAt: number
  failedAtSeq: number | null
}

export interface StartOptions {
  readonly seed: number
  readonly scenario: Scenario
  readonly missionText: string
  readonly mapMode: MapMode
  readonly robotCount: number
}

const STOP_CONFIRMED_STATUSES: readonly RunStatus[] = [
  "stopping",
  "stopped",
  "failed",
  "completed",
]

export function buildStartRequest(requestId: string, options: StartOptions): StartRunRequest {
  const missionText = options.missionText.trim()
  return {
    request_id: requestId,
    scenario: options.scenario,
    seed: options.seed,
    ...(missionText === "" ? {} : { mission_text: missionText }),
    ...(options.mapMode === "static" ? {} : { map_mode: options.mapMode }),
    ...(options.robotCount === 1 ? {} : { robot_count: options.robotCount }),
  }
}

export function isConfirmed(pending: PendingCommand, snapshot: MissionSnapshot): boolean {
  if (pending.kind === "start") {
    return (
      snapshot.run_id !== null &&
      snapshot.run_id !== pending.baselineRunId &&
      snapshot.status !== "idle"
    )
  }
  return (
    snapshot.run_id !== pending.stopRunId || STOP_CONFIRMED_STATUSES.includes(snapshot.status)
  )
}

export function awaitsReconciliation(command: CommandState): boolean {
  return command.phase === "awaiting" || command.phase === "unknown"
}

export function commandState(
  phase: CommandState["phase"],
  kind: CommandKind,
  message: Message | null,
  cause: Message | null = null,
): CommandState {
  return { phase, kind, message, cause, canRetry: false }
}
