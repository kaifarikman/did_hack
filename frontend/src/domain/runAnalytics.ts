export const METRIC_PHASES = ["moving", "turning", "planning", "stationary", "unknown"] as const
export type MetricPhase = (typeof METRIC_PHASES)[number]

export interface MetricPoint {
  simulation_time_s: number
  battery_remaining: number | null
  return_energy: number | null
  sample_signal: number | null
  speed_mps: number | null
  phase: MetricPhase
  continuous: boolean
}

export interface PlannerMetrics {
  requests: number
  deadline_timeouts: number
  fallbacks: number
  last_wait_wall_s: number | null
}

export interface RunMetricsSummary {
  run_id: string
  robot_id: string
  generation: number
  observation_sequence: number | null
  simulation_time_s: number | null
  distance_m: number
  speed_mps: number | null
  reserve_energy: number
  available_energy: number | null
  elapsed_sim_s: number
  elapsed_wall_s: number
  real_time_factor: number | null
  phase: MetricPhase
  phase_seconds: [MetricPhase, number][]
  planner: PlannerMetrics
}

export interface RunAnalytics {
  summary: RunMetricsSummary
  history: MetricPoint[]
  history_limit: number
  sample_interval_s: number
}
