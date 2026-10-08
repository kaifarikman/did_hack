export type RunStatus =
  | "idle"
  | "starting"
  | "running"
  | "returning"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export const ACTIVE_STATUSES: readonly RunStatus[] = ["starting", "running", "returning", "stopping"];
export const FINISHED_STATUSES: readonly RunStatus[] = ["completed", "stopped", "failed"];

export type GoalKind = "explore" | "approach" | "collect" | "return";
export const SCENARIOS = ["easy", "medium", "hard"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const MAP_MODES = ["static", "slam"] as const;
export type MapMode = (typeof MAP_MODES)[number];
export const TASK_TYPES = ["research", "navigation"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type JudgeMode = "local" | "official";
export type PlannerMode = "llm" | "fallback";
export type JournalKind = "observation" | "hypothesis" | "experiment" | "decision" | "outcome" | "error";

export interface Point {
  position_x_m: number;
  position_y_m: number;
}

export interface RobotPose extends Point {
  heading_rad: number;
}

export interface ErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

export interface MissionGoal {
  kind: GoalKind;
  target: Point | null;
  reason: string;
}

export interface CollectedSample {
  sample_id: string;
  position: Point;
}

export interface TerrainEstimate {
  region_id: string;
  center: Point;
  radius_m: number;
  energy_per_m: number;
  confidence: number;
  /** Неопределённость оценки; null у backend 1.0. */
  std_energy_per_m: number | null;
  /** Номер режима: растёт после обнаруженного изменения грунта. */
  regime: number;
  last_measured_s: number | null;
}

export const STEP_STATUSES = ["pending", "active", "done", "rejected", "dropped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface PlanStepView {
  kind: GoalKind;
  target: Point | null;
  reason: string;
  status: StepStatus;
  evidence: string[];
  revise_if: string | null;
}

export interface MissionPlanView {
  plan_id: string;
  source: PlannerMode;
  rationale: string;
  premises: string[];
  fallback_reason: string | null;
  revision_reason: string | null;
  steps: PlanStepView[];
}

export const SENSOR_STATES = ["ok", "suspected", "degraded", "recovering"] as const;
export type SensorState = (typeof SENSOR_STATES)[number];
export const SENSOR_FAULTS = ["noise", "stuck", "dropout"] as const;
export type SensorFault = (typeof SENSOR_FAULTS)[number];

export interface HazardView {
  detection_id: string;
  center: Point;
  radius_m: number;
  hits: number;
}

export interface HypothesisView {
  hypothesis_id: string;
  kind: string;
  status: string;
  center: Point;
  prediction: string;
  measurement: string | null;
  detection_id: string | null;
  experiment_id: string | null;
}

/** Оценки агента: состояние датчика, наблюдаемые опасности, гипотезы. Не истина сценария. */
export interface ResearchView {
  sensor: { state: SensorState; fault: SensorFault | null; quality: number };
  hazards: HazardView[];
  hypotheses: HypothesisView[];
  last_replan_reason: string | null;
  last_replan_detection_id: string | null;
  planner_requests: number;
}

export interface NavigationTarget extends Point {
  /** Версия карты, на которой выбрана точка (из /api/v1/map). */
  map_id: string;
}

export const NAVIGATION_PHASES = ["pending", "moving_to_target", "returning", "finished", "stopped", "failed"] as const;
export type NavigationPhase = (typeof NAVIGATION_PHASES)[number];

/** Состояние пользовательской цели; null у исследования и у state до 1.4. */
export interface NavigationView {
  target: NavigationTarget;
  phase: NavigationPhase;
  target_reached: boolean;
  target_reached_at_s: number | null;
  arrival_tolerance_m: number;
}

export interface MissionSnapshot {
  schema_version: string;
  run_id: string | null;
  robot_id: string;
  generation: number | null;
  observation_sequence: number | null;
  sample_signal_age_s: number | null;
  freshness: Record<"odom" | "scan" | "battery" | "clock", SourceFreshness>;
  revision: number;
  route_revision: number;
  plan_revision: number;
  map_revision: number;
  model_revision: number;
  status: RunStatus;
  scenario: Scenario | null;
  seed: number | null;
  judge_mode: JudgeMode;
  planner_mode: PlannerMode;
  simulation_time_s: number | null;
  map_id: string | null;
  robot_pose: RobotPose | null;
  base_position: Point | null;
  battery_remaining: number | null;
  battery_initial: number;
  sample_signal: number | null;
  samples_collected: number;
  return_energy_estimate: number | null;
  current_goal: MissionGoal | null;
  trajectory: Point[];
  planned_path: Point[];
  collected_samples: CollectedSample[];
  terrain_estimates: TerrainEstimate[];
  last_error: ErrorInfo | null;
  mission_text: string;
  map_mode: MapMode;
  target_samples: number | null;
  plan: MissionPlanView | null;
  research: ResearchView | null;
  /** Командный прогон; null у одного робота и у backend до 1.1. */
  team: TeamView | null;
  /** research по умолчанию; у state до 1.4 всегда research. */
  task_type: TaskType;
  navigation: NavigationView | null;
}

export interface SourceFreshness {
  age_s: number | null;
  fresh: boolean | null;
}

export interface TeamRobotView {
  robot_id: string;
  freshness: Record<"odom" | "scan" | "battery" | "clock", SourceFreshness>;
  status: RunStatus;
  robot_pose: RobotPose | null;
  battery_remaining: number | null;
  samples_collected: number;
  current_goal: MissionGoal | null;
  trajectory: Point[];
  planned_path: Point[];
  reservation: Point | null;
  last_error: ErrorInfo | null;
}

export const TEAM_OUTCOMES = ["running", "success", "partial", "failed", "stopped"] as const;
export type TeamOutcome = (typeof TEAM_OUTCOMES)[number];

export interface TeamView {
  outcome: TeamOutcome;
  samples_collected: number;
  coordinated: boolean;
  lost_robots: string[];
  robots: TeamRobotView[];
}

export interface HealthStatus {
  status: "ready" | "starting";
  ros_connected: boolean;
  judge_mode: JudgeMode;
  llm_available: boolean;
  /** Профили, которые среда применяет при reset; старый backend без поля — только easy. */
  supported_scenarios: Scenario[];
  /** static — готовая карта, slam — строится из наблюдений; у старого backend только static. */
  supported_map_modes: MapMode[];
  supported_robot_counts: number[];
  /** Отсутствие поля означает только research: navigation не предлагается вслепую. */
  supported_task_types: TaskType[];
}

export interface MapOrigin {
  position_x_m: number;
  position_y_m: number;
  heading_rad: number;
}

export interface MapData {
  map_id: string;
  resolution_m: number;
  width: number;
  height: number;
  origin: MapOrigin;
  cells: number[];
}

export interface JournalEntry {
  sequence: number;
  simulation_time_s: number | null;
  kind: JournalKind;
  title: string;
  detail: string;
  hypothesis_id: string | null;
  expected: string | null;
  observed: string | null;
  conclusion: string | null;
  experiment_id: string | null;
  detection_id: string | null;
  plan_id: string | null;
  evidence: string[];
}

export interface JournalPage {
  run_id: string;
  entries: JournalEntry[];
  next_sequence: number;
  has_more: boolean;
}

export interface StartRunRequest {
  request_id: string;
  scenario: Scenario;
  seed: number;
  mission_text?: string;
  map_mode?: MapMode;
  robot_count?: number;
  task_type?: TaskType;
  navigation_target?: NavigationTarget;
}

export interface StopRunRequest {
  request_id: string;
}
