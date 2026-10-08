import { scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

export function buildSuccess(): FixtureScript {
  const mission = standardMission()
  return scriptOf(mission.frames, mission.journal)
}
