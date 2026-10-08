import type { StartBlocker, StopBlocker } from "@/application/viewState"
import type {
  GoalKind,
  JudgeMode,
  MapMode,
  PlannerMode,
  RunStatus,
  Scenario,
  TeamOutcome,
} from "@/domain/contract"
import type { Message, MessageKey } from "@/domain/message"
import type { OutcomeKind as DomainOutcome } from "@/domain/status"

export type MissionKey = Extract<MessageKey, `mission:${string}`>
export type MissionMessage = Message

export type StatusTone = "neutral" | "progress" | "positive" | "attention" | "critical"
export type OutcomeKind = Exclude<DomainOutcome, "none">

export const STATUS_LABELS: Readonly<Record<RunStatus, MissionKey>> = {
  idle: "mission:status.idle",
  starting: "mission:status.starting",
  running: "mission:status.running",
  returning: "mission:status.returning",
  stopping: "mission:status.stopping",
  completed: "mission:status.completed",
  stopped: "mission:status.stopped",
  failed: "mission:status.failed",
}

export const STATUS_TONES: Readonly<Record<RunStatus, StatusTone>> = {
  idle: "neutral",
  starting: "progress",
  running: "progress",
  returning: "progress",
  stopping: "attention",
  completed: "positive",
  stopped: "attention",
  failed: "critical",
}

export const GOAL_LABELS: Readonly<Record<GoalKind, MissionKey>> = {
  explore: "mission:goal.explore",
  approach: "mission:goal.approach",
  collect: "mission:goal.collect",
  return: "mission:goal.return",
}

export const NO_GOAL_LABEL: MissionKey = "mission:goal.none"

export const JUDGE_LABELS: Readonly<Record<JudgeMode, MissionKey>> = {
  local: "mission:judge.local",
  official: "mission:judge.official",
}

export const PLANNER_LABELS: Readonly<Record<PlannerMode, MissionKey>> = {
  llm: "mission:planner.llm",
  fallback: "mission:planner.fallback",
}

export const OUTCOME_LABELS: Readonly<Record<OutcomeKind, MissionKey>> = {
  success: "mission:outcome.success",
  interrupted: "mission:outcome.interrupted",
  failure: "mission:outcome.failure",
}

export const TEAM_OUTCOME_LABELS: Readonly<Record<TeamOutcome, MissionKey>> = {
  running: "mission:teamOutcome.running",
  success: "mission:teamOutcome.success",
  partial: "mission:teamOutcome.partial",
  failed: "mission:teamOutcome.failed",
  stopped: "mission:teamOutcome.stopped",
}

export const SCENARIO_LABELS: Readonly<Record<Scenario, MissionKey>> = {
  easy: "mission:scenario.easy",
  medium: "mission:scenario.medium",
  hard: "mission:scenario.hard",
}

export const MAP_MODE_LABELS: Readonly<Record<MapMode, MissionKey>> = {
  static: "mission:mapMode.static",
  slam: "mission:mapMode.slam",
}

export const MAP_MODE_INLINE_LABELS: Readonly<Record<MapMode, MissionKey>> = {
  static: "mission:mapModeInline.static",
  slam: "mission:mapModeInline.slam",
}

export const METRIC_LABELS = {
  battery: "mission:metric.battery",
  signal: "mission:metric.signal",
  time: "mission:metric.time",
  samples: "mission:metric.samples",
  returnEstimate: "mission:metric.returnEstimate",
  goal: "mission:metric.goal",
} as const satisfies Record<string, MissionKey>

export const START_BLOCKER_LABELS: Readonly<Record<StartBlocker, MissionKey>> = {
  no_snapshot: "mission:blocker.start.noSnapshot",
  offline: "mission:blocker.start.offline",
  health_unknown: "mission:blocker.start.healthUnknown",
  environment_starting: "mission:blocker.start.environmentStarting",
  command_busy: "mission:blocker.start.commandBusy",
  run_active: "mission:blocker.start.runActive",
}

export const STOP_BLOCKER_LABELS: Readonly<Record<StopBlocker, MissionKey>> = {
  no_run: "mission:blocker.stop.noRun",
  offline: "mission:blocker.stop.offline",
  command_busy: "mission:blocker.stop.commandBusy",
  run_inactive: "mission:blocker.stop.runInactive",
  already_stopping: "mission:blocker.stop.alreadyStopping",
}
