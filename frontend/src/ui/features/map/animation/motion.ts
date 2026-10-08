import type { HazardView, Point, RobotPose, TerrainEstimate } from "@/domain/contract"
import type { MapTimings } from "../mapTheme"
import { hazardKey, isNewRoute, type MapScene, pointKey } from "../scene"
import {
  blankPose,
  CADENCE_LAG,
  copyPose,
  interpolatePose,
  lerp,
  type MutablePose,
  nextCadence,
  progress,
  trackDuration,
} from "./interpolate"
import { ScanClock } from "./scan"

interface PoseTrack {
  from: MutablePose
  to: MutablePose
  current: MutablePose
  start: number
  duration: number
  visible: boolean
}

interface TerrainTrack {
  fromCost: number
  toCost: number
  fromConfidence: number
  toConfidence: number
  start: number
}

interface TerrainLook {
  cost: number
  confidence: number
}

const ENERGY_LOW = 0.8
const ENERGY_HIGH = 3

export function terrainCost(estimate: TerrainEstimate): number {
  return Math.min(
    Math.max((estimate.energy_per_m - ENERGY_LOW) / (ENERGY_HIGH - ENERGY_LOW), 0),
    1,
  )
}

export class MapMotion {
  private timings: MapTimings
  private runId: string | null | undefined = undefined
  private lastUpdate: number | null = null
  private cadence = 0
  private readonly poses = new Map<string, PoseTrack>()
  private readonly routes = new Map<string, { path: readonly Point[]; start: number }>()
  private readonly reservations = new Map<string, { key: string | null; start: number }>()
  private readonly marks = new Map<string, number>()
  private readonly terrain = new Map<string, TerrainTrack>()
  private readonly look: TerrainLook = { cost: 0, confidence: 0 }
  readonly scan = new ScanClock()

  constructor(timings: MapTimings) {
    this.timings = timings
    this.scan.setTimings(timings.scanMs, timings.scanTravelMs)
  }

  setTimings(timings: MapTimings): void {
    this.timings = timings
    this.scan.setTimings(timings.scanMs, timings.scanTravelMs)
  }

  update(scene: MapScene, now: number): void {
    const fresh = scene.runId !== this.runId
    if (fresh) this.reset(scene.runId)
    const interval = this.lastUpdate === null ? 0 : now - this.lastUpdate
    const { minTrackMs, maxTrackMs } = this.timings
    this.cadence = nextCadence(this.cadence, interval, minTrackMs)
    const duration = trackDuration(this.cadence * CADENCE_LAG, minTrackMs, maxTrackMs)
    this.lastUpdate = now
    const settled = fresh ? Number.NEGATIVE_INFINITY : now
    for (const robot of scene.robots) {
      this.trackPose(robot.id, robot.pose, now, fresh ? 0 : duration)
      this.scan.note(robot.id, robot.lost ? null : robot.pose, now)
      this.trackRoute(robot.id, robot.plannedPath, settled)
      this.trackReservation(robot.id, pointKey(robot.reservation), settled)
    }
    for (const sample of scene.samples) this.mark(`sample:${sample.sample_id}`, settled)
    for (const hazard of scene.hazards) this.ringHazard(hazard, settled, now)
    for (const estimate of scene.terrain) this.trackTerrain(estimate, settled)
  }

  advance(now: number): boolean {
    return this.advanceTracks(now) || this.scan.active(now)
  }

  private advanceTracks(now: number): boolean {
    let active = false
    for (const track of this.poses.values()) {
      const ratio = progress(now, track.start, track.duration)
      interpolatePose(track.current, track.from, track.to, ratio)
      if (ratio < 1) active = true
    }
    const { drawMs, eventMs } = this.timings
    for (const route of this.routes.values())
      if (progress(now, route.start, drawMs) < 1) active = true
    for (const start of this.marks.values())
      if (progress(now, start, eventMs) < 1) active = true
    for (const track of this.terrain.values())
      if (progress(now, track.start, eventMs) < 1) active = true
    for (const fade of this.reservations.values())
      if (progress(now, fade.start, this.timings.fadeMs) < 1) active = true
    return active
  }

  pose(robotId: string): RobotPose | null {
    const track = this.poses.get(robotId)
    return track === undefined || !track.visible ? null : track.current
  }

  target(robotId: string): RobotPose | null {
    const track = this.poses.get(robotId)
    return track === undefined || !track.visible ? null : track.to
  }

  routeProgress(robotId: string, now: number): number {
    const route = this.routes.get(robotId)
    return route === undefined
      ? 1
      : this.timings.easing(progress(now, route.start, this.timings.drawMs))
  }

  reservationOpacity(robotId: string, now: number): number {
    const fade = this.reservations.get(robotId)
    return fade === undefined
      ? 1
      : this.timings.easing(progress(now, fade.start, this.timings.fadeMs))
  }

  eventProgress(key: string, now: number): number {
    const start = this.marks.get(key)
    return start === undefined ? 1 : progress(now, start, this.timings.eventMs)
  }

  terrainLook(estimate: TerrainEstimate, now: number): TerrainLook {
    const track = this.terrain.get(estimate.region_id)
    if (track === undefined) {
      this.look.cost = terrainCost(estimate)
      this.look.confidence = estimate.confidence
      return this.look
    }
    const ratio = this.timings.easing(progress(now, track.start, this.timings.eventMs))
    this.look.cost = lerp(track.fromCost, track.toCost, ratio)
    this.look.confidence = lerp(track.fromConfidence, track.toConfidence, ratio)
    return this.look
  }

  private reset(runId: string | null): void {
    this.runId = runId
    this.lastUpdate = null
    this.cadence = 0
    this.poses.clear()
    this.routes.clear()
    this.reservations.clear()
    this.marks.clear()
    this.terrain.clear()
    this.scan.clear()
  }

  private trackPose(
    robotId: string,
    pose: RobotPose | null,
    now: number,
    duration: number,
  ): void {
    const track = this.poses.get(robotId)
    if (pose === null) {
      if (track !== undefined) track.visible = false
      return
    }
    if (track === undefined || !track.visible) {
      const fresh = copyPose(blankPose(), pose)
      this.poses.set(robotId, {
        from: fresh,
        to: copyPose(blankPose(), pose),
        current: copyPose(blankPose(), pose),
        start: now,
        duration: 0,
        visible: true,
      })
      return
    }
    copyPose(track.from, track.current)
    copyPose(track.to, pose)
    track.start = now
    track.duration = duration
  }

  private trackRoute(robotId: string, path: readonly Point[], now: number): void {
    const previous = this.routes.get(robotId)
    const start =
      previous === undefined || isNewRoute(previous.path, path) ? now : previous.start
    this.routes.set(robotId, { path, start })
  }

  private trackReservation(robotId: string, key: string | null, now: number): void {
    const previous = this.reservations.get(robotId)
    if (previous !== undefined && previous.key === key) return
    this.reservations.set(robotId, {
      key,
      start: key === null ? Number.NEGATIVE_INFINITY : now,
    })
  }

  private ringHazard(hazard: HazardView, start: number, now: number): void {
    const key = `hazard:${hazardKey(hazard)}`
    if (this.marks.has(key)) return
    const sameHazard = `hazard:${hazard.detection_id}#`
    for (const [other, ringStart] of this.marks)
      if (other.startsWith(sameHazard) && progress(now, ringStart, this.timings.eventMs) < 1)
        return
    this.marks.set(key, start)
  }

  private mark(key: string, now: number): void {
    if (!this.marks.has(key)) this.marks.set(key, now)
  }

  private trackTerrain(estimate: TerrainEstimate, now: number): void {
    const cost = terrainCost(estimate)
    const track = this.terrain.get(estimate.region_id)
    if (track === undefined) {
      const settled = now === Number.NEGATIVE_INFINITY
      this.terrain.set(estimate.region_id, {
        fromCost: cost,
        toCost: cost,
        fromConfidence: settled ? estimate.confidence : 0,
        toConfidence: estimate.confidence,
        start: now,
      })
      return
    }
    if (track.toCost === cost && track.toConfidence === estimate.confidence) return
    const shown = this.terrainLook(estimate, now)
    track.fromCost = shown.cost
    track.fromConfidence = shown.confidence
    track.toCost = cost
    track.toConfidence = estimate.confidence
    track.start = now
  }
}
