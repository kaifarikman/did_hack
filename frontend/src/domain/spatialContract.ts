export interface Point {
  position_x_m: number
  position_y_m: number
}

export interface RobotPose extends Point {
  heading_rad: number
}

export const TASK_TYPES = ["research", "navigation"] as const
export type TaskType = (typeof TASK_TYPES)[number]
export interface NavigationTarget extends Point {
  map_id: string
}
export const NAVIGATION_PHASES = [
  "pending",
  "moving_to_target",
  "returning",
  "finished",
  "stopped",
  "failed",
] as const
export type NavigationPhase = (typeof NAVIGATION_PHASES)[number]
export interface NavigationView {
  target: NavigationTarget
  phase: NavigationPhase
  target_reached: boolean
  target_reached_at_s: number | null
  arrival_tolerance_m: number
}
export interface SourceFreshness {
  age_s: number | null
  fresh: boolean | null
}
export type FreshnessSet = Record<"odom" | "scan" | "battery" | "clock", SourceFreshness>

export interface MapOrigin {
  position_x_m: number
  position_y_m: number
  heading_rad: number
}

export interface MapData {
  map_id: string
  resolution_m: number
  width: number
  height: number
  origin: MapOrigin
  cells: number[]
}
