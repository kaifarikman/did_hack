import type { MapData, MissionSnapshot } from "../../../domain/contract"
import { BASE, fixtureMap, scriptOf } from "../baseline"
import type { FixtureScript, MapRevision } from "../script"
import { revealMap, slamMapId } from "../slamMap"
import { standardMission } from "../standardMission"

export const SLAM_FIRST_MAP_AT = 3
const FRAMES_PER_REVISION = 6
const REVEAL_RADIUS_M = 0.6
const LATE_REVISION = 3

function revisionAt(index: number): number {
  if (index < SLAM_FIRST_MAP_AT) return 0
  return 1 + Math.floor((index - SLAM_FIRST_MAP_AT) / FRAMES_PER_REVISION)
}

function seenBy(frame: MissionSnapshot) {
  return frame.trajectory.length > 0 ? frame.trajectory : [BASE]
}

function buildRevisions(frames: MissionSnapshot[]): MapRevision[] {
  const revisions: MapRevision[] = [
    { fromFrame: -1, map: fixtureMap },
    { fromFrame: 0, map: null },
  ]
  frames.forEach((frame, index) => {
    const revision = revisionAt(index)
    if (revision === 0 || revisionAt(index - 1) === revision) return
    const map: MapData = revealMap(fixtureMap, seenBy(frame), REVEAL_RADIUS_M, revision)
    const delay = revision === LATE_REVISION ? 1 : 0
    revisions.push({ fromFrame: index + delay, map })
  })
  return revisions
}

export function buildSlamBuilding(): FixtureScript {
  const mission = standardMission()
  const frames = mission.frames.map((frame, index) => ({
    ...frame,
    map_mode: "slam" as const,
    map_id: slamMapId(revisionAt(index)),
  }))
  return scriptOf(frames, mission.journal, { maps: buildRevisions(frames) })
}
