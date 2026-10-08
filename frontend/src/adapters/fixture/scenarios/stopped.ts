import type { MissionSnapshot } from "../../../domain/contract"
import { scriptOf, timed } from "../baseline"
import { journalEntryFrom } from "../content"
import gatewayContent from "../examples/content/gateway.json"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"
import { teamLayer } from "../team"

const STOP_REQUESTED_AT = 20

export function buildStopped(): FixtureScript {
  const mission = standardMission()
  const kept = mission.frames.slice(0, STOP_REQUESTED_AT + 1)
  const last = kept[kept.length - 1] as MissionSnapshot
  const halted = { current_goal: null, planned_path: [] }
  const frames: MissionSnapshot[] = [
    ...kept,
    { ...last, status: "stopping", simulation_time_s: STOP_REQUESTED_AT + 1 },
    { ...last, ...halted, status: "stopped", simulation_time_s: STOP_REQUESTED_AT + 2 },
  ]
  const marks = { ...mission.timeline.marks, finalIndex: frames.length - 1 }
  const team = teamLayer({ finalOutcome: "stopped", lostAtFrame: null, lostError: null })
  const withTeam = frames.map((frame, index) => ({ ...frame, ...team(frame, index, marks) }))
  const journal = [
    ...mission.journal.filter((item) => item.atFrame <= STOP_REQUESTED_AT),
    timed(STOP_REQUESTED_AT + 1, journalEntryFrom(gatewayContent.stopDecision)),
  ]
  return scriptOf(withTeam, journal)
}
