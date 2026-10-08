import { DEFAULT_BEHAVIOR, scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

export function buildStartRejected(): FixtureScript {
  const mission = standardMission()
  return scriptOf(mission.frames, mission.journal, {
    behavior: { ...DEFAULT_BEHAVIOR, startRejections: 1 },
  })
}
