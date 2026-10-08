import { READY_HEALTH, scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

export function buildIdleReady(): FixtureScript {
  const mission = standardMission()
  const frames = mission.frames.map((frame) => ({ ...frame, judge_mode: "official" as const }))
  return scriptOf(frames, mission.journal, {
    health: [{ ...READY_HEALTH, judge_mode: "official" }],
  })
}
