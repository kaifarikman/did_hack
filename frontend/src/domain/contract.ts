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
}

export interface MissionSnapshot {
  schema_version: string;
  run_id: string | null;
  revision: number;
  status: RunStatus;
  scenario: "easy" | null;
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
}

export interface HealthStatus {
  status: "ready" | "starting";
  ros_connected: boolean;
  judge_mode: JudgeMode;
  llm_available: boolean;
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
}

export interface JournalPage {
  run_id: string;
  entries: JournalEntry[];
  next_sequence: number;
  has_more: boolean;
}

export interface StartRunRequest {
  request_id: string;
  scenario: "easy";
  seed: number;
}

export interface StopRunRequest {
  request_id: string;
}
