import { DEFAULT_BEHAVIOR, scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

const OUTAGE_FRAME_INDEX = 14
export const OUTAGE_REQUEST_COUNT = 24

export function buildDisconnect(): FixtureScript {
  const mission = standardMission()
  return scriptOf(mission.frames, mission.journal, {
    behavior: {
      ...DEFAULT_BEHAVIOR,
      outage: { atFrame: OUTAGE_FRAME_INDEX, requests: OUTAGE_REQUEST_COUNT },
      journalFailureAtFrame: OUTAGE_FRAME_INDEX - 2,
    },
  })
}
