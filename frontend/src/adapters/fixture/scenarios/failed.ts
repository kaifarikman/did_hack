import type { MissionSnapshot } from "../../../domain/contract"
import { missionError, scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"
import { teamLayer } from "../team"
import type { TimelineMarks } from "../timeline"

const FAIL_AT_RETURN_STEP = 10
const STALE_FROM = 3
const STALE_FRAMES = 3

function errorFor(frame: MissionSnapshot, index: number, marks: TimelineMarks) {
  if (index === marks.finalIndex) return missionError("rosLost")
  const staleStart = marks.returnStart + STALE_FROM
  if (index >= staleStart && index < staleStart + STALE_FRAMES)
    return missionError("observationsStale")
  return frame.last_error
}

export function buildFailed(): FixtureScript {
  const mission = standardMission({ timeline: { failAtReturnStep: FAIL_AT_RETURN_STEP } })
  const { marks } = mission.timeline
  const team = teamLayer({ finalOutcome: "failed", lostAtFrame: null, lostError: null })
  const frames = mission.frames.map((frame, index) => {
    const withError = { ...frame, last_error: errorFor(frame, index, marks) }
    return { ...withError, ...team(withError, index, marks) }
  })
  return scriptOf(frames, mission.journal)
}
