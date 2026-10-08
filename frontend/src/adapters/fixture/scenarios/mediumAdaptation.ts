import type { HypothesisView, MissionSnapshot, TerrainEstimate } from "../../../domain/contract"
import { BASE, scriptOf, TERRAIN_CENTER, timed } from "../baseline"
import { hypothesesFrom, journalEntryFrom } from "../content"
import content from "../examples/scenarios/mediumAdaptation.json"
import { manhattanRoute, point } from "../route"
import type { FixtureScript } from "../script"
import { standardHypotheses, standardMission } from "../standardMission"
import type { TimelineMarks } from "../timeline"

const SHIFT_OFFSET = 6
const DETOUR_FRAMES = 4
const H = content.hypotheses
const [RETURN_TESTING, RETURN_REFUTED, CHANGE_PROPOSED, CHANGE_CONFIRMED, AREA_DEFERRED] =
  hypothesesFrom([
    H.returnTesting,
    H.returnRefuted,
    H.changeProposed,
    H.changeConfirmed,
    H.areaDeferred,
  ])

function terrain(index: number, shiftAt: number): TerrainEstimate[] {
  const shifted = index >= shiftAt
  const nearBase: TerrainEstimate = {
    region_id: "observed-area-1",
    center: TERRAIN_CENTER,
    radius_m: 0.3,
    energy_per_m: shifted ? 2.9 : 2.0,
    confidence: shifted ? 0.3 + Math.min(index - shiftAt, 6) * 0.08 : 0.7,
    std_energy_per_m: shifted ? 0.4 : 0.2,
    regime: shifted ? 1 : 0,
    last_measured_s: index,
  }
  const nearSample: TerrainEstimate = {
    region_id: "observed-area-2",
    center: point(-0.6, -0.1),
    radius_m: 0.25,
    energy_per_m: 1.4,
    confidence: 0.5,
    std_energy_per_m: 0.3,
    regime: 0,
    last_measured_s: Math.min(index, shiftAt),
  }
  return index < 6 ? [] : [nearBase, nearSample]
}

function hypotheses(index: number, marks: TimelineMarks, shiftAt: number): HypothesisView[] {
  const second =
    index >= shiftAt + 2
      ? RETURN_REFUTED
      : index >= marks.returnStart + 5
        ? RETURN_TESTING
        : undefined
  const standard = standardHypotheses(index, marks).map((item) =>
    second !== undefined && item.hypothesis_id === second.hypothesis_id ? second : item,
  )
  const change =
    index >= shiftAt + 6 ? CHANGE_CONFIRMED : index >= shiftAt ? CHANGE_PROPOSED : undefined
  const deferred = index >= shiftAt + 4 ? AREA_DEFERRED : undefined
  return [...standard, change, deferred].filter(
    (item): item is HypothesisView => item !== undefined,
  )
}

function adapt(
  frame: MissionSnapshot,
  index: number,
  marks: TimelineMarks,
  shiftAt: number,
): MissionSnapshot {
  const detour = index >= shiftAt + 2 && index < shiftAt + 2 + DETOUR_FRAMES
  const pose = frame.robot_pose
  return {
    ...frame,
    scenario: "medium",
    terrain_estimates: terrain(index, shiftAt),
    planned_path:
      detour && pose !== null ? manhattanRoute(pose, BASE).slice(0, 6) : frame.planned_path,
    research:
      frame.research === null
        ? null
        : {
            ...frame.research,
            hypotheses: hypotheses(index, marks, shiftAt),
            last_replan_reason: index >= shiftAt + 2 ? content.replanReason : null,
          },
  }
}

export function buildMediumAdaptation(): FixtureScript {
  const mission = standardMission()
  const { marks } = mission.timeline
  const shiftAt = marks.returnStart + SHIFT_OFFSET
  const frames = mission.frames.map((frame, index) => adapt(frame, index, marks, shiftAt))
  const J = content.journal
  return scriptOf(frames, [
    ...mission.journal,
    timed(marks.returnStart + 5, journalEntryFrom(J.experiment)),
    timed(shiftAt, journalEntryFrom(J.regimeChange)),
    timed(shiftAt + 1, journalEntryFrom(J.observation)),
    timed(shiftAt + 2, journalEntryFrom(J.verdict)),
    timed(shiftAt + 2, journalEntryFrom(J.replan)),
  ])
}
