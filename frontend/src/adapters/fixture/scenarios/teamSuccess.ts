import { scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"
import { teamLayer } from "../team"

export function buildTeamSuccess(): FixtureScript {
  const mission = standardMission()
  const { marks } = mission.timeline
  const team = teamLayer({ finalOutcome: "success", lostAtFrame: null, lostError: null })
  const frames = mission.frames.map((frame, index) => ({
    ...frame,
    ...team(frame, index, marks),
  }))
  return scriptOf(frames, mission.journal)
}
