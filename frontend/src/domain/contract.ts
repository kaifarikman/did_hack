import type { HypothesisView } from "./researchContract"

export type { HypothesisView } from "./researchContract"

import type { RunAnalytics } from "./runAnalytics"
import type { CollectedSample, TerrainEstimate } from "./terrainContract"

export type { CollectedSample, TerrainEstimate } from "./terrainContract"

import type {
  FreshnessSet,
  NavigationTarget,
  NavigationView,
  Point,
  RobotPose,
  TaskType,
} from "./spatialContract"

export type {
  FreshnessSet,
  MapData,
  MapOrigin,
  NavigationPhase,
  NavigationTarget,
  NavigationView,
  Point,
  RobotPose,
  SourceFreshness,
  TaskType,
} from "./spatialContract"
export { NAVIGATION_PHASES, TASK_TYPES } from "./spatialContract"
export const RUN_STATUSES = [
  "idle",
  "starting",
  "running",
  "returning",
  "stopping",
  "completed",
  "stopped",
  "failed",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const ACTIVE_STATUSES: readonly RunStatus[] = [
  "starting",
  "running",
  "returning",
  "stopping",
]
export const FINISHED_STATUSES: readonly RunStatus[] = ["completed", "stopped", "failed"]

export const GOAL_KINDS = ["explore", "approach", "collect", "return"] as const
export type GoalKind = (typeof GOAL_KINDS)[number]
export const SCENARIOS = ["easy", "medium", "hard"] as const
export type Scenario = (typeof SCENARIOS)[number]
export const MAP_MODES = ["static", "slam"] as const
export type MapMode = (typeof MAP_MODES)[number]
export const JUDGE_MODES = ["local", "official"] as const
export type JudgeMode = (typeof JUDGE_MODES)[number]
export const PLANNER_MODES = ["llm", "fallback"] as const
export type PlannerMode = (typeof PLANNER_MODES)[number]
export const JOURNAL_KINDS = [
  "observation",
  "hypothesis",
  "experiment",
  "decision",
  "outcome",
  "error",
] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

export interface ErrorInfo {
  code: string
  message: string
  retryable: boolean
}

export interface MissionGoal {
  kind: GoalKind
  target: Point | null
  reason: string
}

export const STEP_STATUSES = ["pending", "active", "done", "rejected", "dropped"] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export interface PlanStepView {
  kind: GoalKind
  target: Point | null
  reason: string
  status: StepStatus
  evidence: string[]
  revise_if: string | null
}

export interface MissionPlanView {
  plan_id: string
  source: PlannerMode
  rationale: string
  premises: string[]
  fallback_reason: string | null
  revision_reason: string | null
  steps: PlanStepView[]
}

export const SENSOR_STATES = ["ok", "suspected", "degraded", "recovering"] as const
export type SensorState = (typeof SENSOR_STATES)[number]
export const SENSOR_FAULTS = ["noise", "stuck", "dropout"] as const
export type SensorFault = (typeof SENSOR_FAULTS)[number]

export interface HazardView {
  detection_id: string
  center: Point
  radius_m: number
  hits: number
}

export interface ResearchView {
  sensor: { state: SensorState; fault: SensorFault | null; quality: number }
  hazards: HazardView[]
  hypotheses: HypothesisView[]
  last_replan_reason: string | null
  last_replan_detection_id: string | null
  planner_requests: number
  active_hypothesis_id?: string | null
}

export interface MissionSnapshot {
  analytics?: RunAnalytics | null
  schema_version: string
  run_id: string | null
  robot_id: string
  generation: number | null
  observation_sequence: number | null
  sample_signal_age_s: number | null
  freshness: FreshnessSet
  route_revision: number
  plan_revision: number
  map_revision: number
  model_revision: number
  task_type: TaskType
  navigation: NavigationView | null
  revision: number
  status: RunStatus
  scenario: Scenario | null
  seed: number | null
  judge_mode: JudgeMode
  planner_mode: PlannerMode
  simulation_time_s: number | null
  map_id: string | null
  robot_pose: RobotPose | null
  base_position: Point | null
  battery_remaining: number | null
  battery_initial: number
  sample_signal: number | null
  samples_collected: number
  return_energy_estimate: number | null
  current_goal: MissionGoal | null
  trajectory: Point[]
  planned_path: Point[]
  collected_samples: CollectedSample[]
  terrain_estimates: TerrainEstimate[]
  last_error: ErrorInfo | null
  mission_text: string
  map_mode: MapMode
  target_samples: number | null
  plan: MissionPlanView | null
  research: ResearchView | null
  team: TeamView | null
}

export interface TeamRobotView {
  freshness: FreshnessSet
  robot_id: string
  status: RunStatus
  robot_pose: RobotPose | null
  battery_remaining: number | null
  samples_collected: number
  current_goal: MissionGoal | null
  trajectory: Point[]
  planned_path: Point[]
  reservation: Point | null
  last_error: ErrorInfo | null
}

export const TEAM_OUTCOMES = ["running", "success", "partial", "failed", "stopped"] as const
export type TeamOutcome = (typeof TEAM_OUTCOMES)[number]

export interface TeamView {
  outcome: TeamOutcome
  samples_collected: number
  coordinated: boolean
  lost_robots: string[]
  robots: TeamRobotView[]
}

export interface HealthStatus {
  status: "ready" | "starting"
  ros_connected: boolean
  judge_mode: JudgeMode
  llm_available: boolean
  supported_scenarios: Scenario[]
  supported_map_modes: MapMode[]
  supported_robot_counts: number[]
  supported_task_types: TaskType[]
}

export interface JournalEntry {
  sequence: number
  simulation_time_s: number | null
  kind: JournalKind
  title: string
  detail: string
  hypothesis_id: string | null
  expected: string | null
  observed: string | null
  conclusion: string | null
  experiment_id: string | null
  detection_id: string | null
  plan_id: string | null
  evidence: string[]
}

export interface JournalPage {
  run_id: string
  entries: JournalEntry[]
  next_sequence: number
  has_more: boolean
}

export interface StartRunRequest {
  request_id: string
  scenario: Scenario
  seed: number
  mission_text?: string
  map_mode?: MapMode
  robot_count?: number
  task_type?: TaskType
  navigation_target?: NavigationTarget
}

export interface StopRunRequest {
  request_id: string
}
