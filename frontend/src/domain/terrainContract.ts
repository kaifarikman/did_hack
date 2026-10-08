import type { Point } from "./spatialContract"
export interface CollectedSample {
  sample_id: string
  position: Point
}

export interface TerrainEstimate {
  region_id: string
  center: Point
  radius_m: number
  energy_per_m: number
  confidence: number
  std_energy_per_m: number | null
  regime: number
  last_measured_s: number | null
}
