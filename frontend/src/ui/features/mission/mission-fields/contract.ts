import type { MapMode, Scenario } from "@/domain/contract"

export type RobotCount = "1" | "2"

export interface MissionDraft {
  readonly scenario: Scenario
  readonly mapMode: MapMode
  readonly robots: RobotCount
  readonly seed: number | null
  readonly missionText: string
}

export interface MissionAllowance {
  readonly scenarios: readonly string[]
  readonly mapModes: readonly string[]
  readonly robotCounts: readonly number[]
}
