import type { Point } from "./spatialContract"

export interface HypothesisView {
  hypothesis_id: string
  kind: string
  status: string
  center: Point
  prediction: string
  measurement: string | null
  detection_id: string | null
  experiment_id: string | null
  expected_signal?: number | null
  measured_signal?: number | null
  baseline_signal?: number | null
  measurement_count?: number
  action?: string | null
  conclusion?: string | null
  expected_energy_per_m?: number | null
  measured_energy_per_m?: number | null
  measured_distance_m?: number
  confirm_at_least?: number | null
  confirm_at_most?: number | null
}
