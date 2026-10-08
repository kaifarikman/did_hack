import type { MissionSnapshot } from "../../../domain/contract"
import { SAMPLE_PLACE, scriptOf, timed } from "../baseline"
import { journalEntryFrom, planFrom } from "../content"
import content from "../examples/scenarios/planRevision.json"
import { manhattanRoute } from "../route"
import type { FixtureScript } from "../script"
import { progressPlan, standardMission } from "../standardMission"

export const REVISION_AT = 12
const DETOUR_FRAMES = 4
const PATH_PREVIEW = 6
const REVISED_PLAN = planFrom(content.revisedPlan)

function detourPath(frame: MissionSnapshot): MissionSnapshot["planned_path"] {
  if (frame.robot_pose === null) return frame.planned_path
  return manhattanRoute(SAMPLE_PLACE, frame.robot_pose).reverse().slice(0, PATH_PREVIEW)
}

function revise(frame: MissionSnapshot, index: number): MissionSnapshot {
  if (index < REVISION_AT || frame.research === null) return frame
  const detour = index < REVISION_AT + DETOUR_FRAMES
  return {
    ...frame,
    plan: progressPlan(REVISED_PLAN, frame),
    planned_path: detour ? detourPath(frame) : frame.planned_path,
    research: {
      ...frame.research,
      last_replan_reason: content.replanReason,
      planner_requests: frame.research.planner_requests + 1,
    },
  }
}

export function buildPlanRevision(): FixtureScript {
  const mission = standardMission()
  const frames = mission.frames.map(revise)
  return scriptOf(frames, [
    ...mission.journal,
    timed(REVISION_AT, journalEntryFrom(content.revisionEntry)),
  ])
}
