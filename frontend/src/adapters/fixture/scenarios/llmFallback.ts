import { scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

const LLM_FAILS_AT_FRAME = 10

export function buildLlmFallback(): FixtureScript {
  const mission = standardMission({ llmFailsAtFrame: LLM_FAILS_AT_FRAME })
  return scriptOf(mission.frames, mission.journal)
}
