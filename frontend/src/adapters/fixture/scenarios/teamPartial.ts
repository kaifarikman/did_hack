import { missionError, scriptOf, timed } from "../baseline"
import { journalEntryFrom } from "../content"
import content from "../examples/scenarios/teamPartial.json"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"
import { teamLayer } from "../team"

export const PARTNER_LOST_AT = 20

export function buildTeamPartial(): FixtureScript {
  const mission = standardMission()
  const { marks } = mission.timeline
  const team = teamLayer({
    finalOutcome: "partial",
    lostAtFrame: PARTNER_LOST_AT,
    lostError: missionError("observationsStale"),
  })
  const frames = mission.frames.map((frame, index) => ({
    ...frame,
    ...team(frame, index, marks),
  }))
  return scriptOf(frames, [
    ...mission.journal,
    timed(PARTNER_LOST_AT, journalEntryFrom(content.partnerLost)),
    timed(PARTNER_LOST_AT + 1, journalEntryFrom(content.continueAlone)),
  ])
}
