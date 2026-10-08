import { describe, expect, it } from "vitest"
import { buildScript } from "../../../src/adapters/fixture/catalog"
import type { MissionSnapshot } from "../../../src/domain/contract"
import { MapMotion, terrainCost } from "../../../src/ui/features/map/animation/motion"
import { linear } from "../../../src/ui/features/map/easing"
import type { MapTimings } from "../../../src/ui/features/map/mapTheme"
import { buildScene, hazardKey, isNewRoute } from "../../../src/ui/features/map/scene"

const TIMINGS: MapTimings = {
  drawMs: 900,
  eventMs: 320,
  fadeMs: 200,
  minTrackMs: 160,
  maxTrackMs: 900,
  easing: linear,
}
const REDUCED: MapTimings = {
  ...TIMINGS,
  drawMs: 0,
  eventMs: 0,
  fadeMs: 0,
  minTrackMs: 0,
  maxTrackMs: 0,
}

function run(frames: readonly MissionSnapshot[]): MissionSnapshot[] {
  return frames.map((frame) => ({ ...frame, run_id: "run-test" }))
}

const success = run(buildScript("success").frames)
const hard = run(buildScript("hard_events").frames)
const team = run(buildScript("team_success").frames)

function at(frames: readonly MissionSnapshot[], index: number): MissionSnapshot {
  const frame = frames[index]
  if (frame === undefined) throw new Error(`missing frame ${index}`)
  return frame
}

describe("map motion", () => {
  it("interpolates the robot between snapshots and settles", () => {
    const motion = new MapMotion(TIMINGS)
    motion.update(buildScene(at(success, 5)), 0)
    motion.update(buildScene(at(success, 6)), 500)
    expect(motion.advance(750)).toBe(true)
    const from = at(success, 5).robot_pose?.position_x_m ?? 0
    const to = at(success, 6).robot_pose?.position_x_m ?? 0
    expect(motion.pose("robot_1")?.position_x_m).toBeCloseTo((from + to) / 2)
    expect(motion.advance(1500)).toBe(false)
    expect(motion.pose("robot_1")?.position_x_m).toBeCloseTo(to)
  })

  it("moves the robot at a constant speed even when events use an ease-out curve", () => {
    const motion = new MapMotion({ ...TIMINGS, easing: (ratio) => 1 - (1 - ratio) ** 4 })
    motion.update(buildScene(at(success, 5)), 0)
    motion.update(buildScene(at(success, 6)), 500)
    motion.advance(750)
    const from = at(success, 5).robot_pose?.position_x_m ?? 0
    const to = at(success, 6).robot_pose?.position_x_m ?? 0
    expect(motion.pose("robot_1")?.position_x_m).toBeCloseTo((from + to) / 2)
  })

  it("jumps straight to the new pose under reduced motion", () => {
    const motion = new MapMotion(REDUCED)
    motion.update(buildScene(at(success, 5)), 0)
    motion.update(buildScene(at(success, 6)), 500)
    expect(motion.advance(500)).toBe(false)
    expect(motion.pose("robot_1")?.position_x_m).toBeCloseTo(
      at(success, 6).robot_pose?.position_x_m ?? 0,
    )
  })

  it("hides a robot without a pose", () => {
    const motion = new MapMotion(TIMINGS)
    motion.update(buildScene(at(success, 0)), 0)
    motion.advance(0)
    expect(motion.pose("robot_1")).toBeNull()
  })

  it("pops a newly collected sample but not one present on the first snapshot", () => {
    const collectedAt = success.findIndex((frame) => frame.collected_samples.length > 0)
    const motion = new MapMotion(TIMINGS)
    motion.update(buildScene(at(success, collectedAt - 1)), 0)
    motion.update(buildScene(at(success, collectedAt)), 500)
    expect(motion.eventProgress("sample:sample-1", 660)).toBeCloseTo(0.5)
    expect(motion.eventProgress("sample:sample-1", 900)).toBe(1)
    const late = new MapMotion(TIMINGS)
    late.update(buildScene(at(success, collectedAt + 2)), 0)
    expect(late.eventProgress("sample:sample-1", 0)).toBe(1)
  })

  it("does not restart a hazard ring while the previous one is still playing", () => {
    const motion = new MapMotion(TIMINGS)
    const base = at(
      hard,
      hard.findIndex((frame) => (frame.research?.hazards.length ?? 0) > 0),
    )
    const hazard = base.research?.hazards[0]
    if (hazard === undefined || base.research === null) throw new Error("hazard expected")
    const withHits = (hits: number): MissionSnapshot => ({
      ...base,
      research: { ...base.research, hazards: [{ ...hazard, hits }] } as typeof base.research,
    })
    motion.update(buildScene(at(hard, 0)), 0)
    motion.update(buildScene(withHits(1)), 100)
    motion.update(buildScene(withHits(2)), 200)
    expect(motion.eventProgress(`hazard:${hazardKey({ ...hazard, hits: 2 })}`, 200)).toBe(1)
    motion.update(buildScene(withHits(3)), 600)
    expect(motion.eventProgress(`hazard:${hazardKey({ ...hazard, hits: 3 })}`, 600)).toBe(0)
  })

  it("rings a hazard again when its hit count grows", () => {
    const motion = new MapMotion(TIMINGS)
    const before = hard.findIndex((frame) => (frame.research?.hazards.length ?? 0) > 0) - 1
    motion.update(buildScene(at(hard, before)), 0)
    motion.update(buildScene(at(hard, before + 1)), 500)
    const first = at(hard, before + 1).research?.hazards[0]
    if (first === undefined) throw new Error("hazard expected")
    expect(motion.eventProgress(`hazard:${hazardKey(first)}`, 500)).toBe(0)
    const repeat = hard.findIndex((frame) => (frame.research?.hazards[0]?.hits ?? 0) > 1)
    motion.update(buildScene(at(hard, repeat)), 2000)
    const second = at(hard, repeat).research?.hazards[0]
    if (second === undefined) throw new Error("hazard expected")
    expect(motion.eventProgress(`hazard:${hazardKey(second)}`, 2000)).toBe(0)
  })

  it("draws a new route but keeps a continuing one", () => {
    const motion = new MapMotion(TIMINGS)
    motion.update(buildScene(at(success, 3)), 0)
    motion.advance(2000)
    motion.update(buildScene(at(success, 4)), 2000)
    expect(motion.routeProgress("robot_1", 2000)).toBe(1)
    const returning = success.findIndex((frame) => frame.status === "returning")
    motion.update(buildScene(at(success, returning - 1)), 3000)
    motion.update(buildScene(at(success, returning)), 3500)
    expect(motion.routeProgress("robot_1", 3500)).toBe(0)
    expect(motion.routeProgress("robot_1", 3950)).toBeCloseTo(0.5)
  })

  it("blends terrain cost toward a new estimate", () => {
    const motion = new MapMotion(TIMINGS)
    const before = at(success, 23)
    const after = at(success, 24)
    motion.update(buildScene(before), 0)
    motion.update(buildScene(after), 1000)
    const [estimate] = after.terrain_estimates
    const [previous] = before.terrain_estimates
    if (estimate === undefined || previous === undefined) throw new Error("terrain expected")
    const halfway = motion.terrainLook(estimate, 1160)
    expect(halfway.cost).toBeCloseTo((terrainCost(previous) + terrainCost(estimate)) / 2)
    expect(motion.terrainLook(estimate, 5000).confidence).toBeCloseTo(estimate.confidence)
  })

  it("fades a partner reservation in", () => {
    const motion = new MapMotion(TIMINGS)
    motion.update(buildScene(at(team, 0)), 0)
    motion.update(buildScene(at(team, 1)), 500)
    expect(motion.reservationOpacity("robot_2", 600)).toBeCloseTo(0.5)
    expect(motion.reservationOpacity("robot_2", 800)).toBe(1)
  })
})

describe("map scene", () => {
  it("is empty without a snapshot and lists partners with their loss", () => {
    expect(buildScene(null).robots).toEqual([])
    const partial = buildScript("team_partial").frames
    const scene = buildScene(partial[partial.length - 1] ?? null)
    expect(scene.robots.map((robot) => [robot.id, robot.partner, robot.lost])).toEqual([
      ["robot_1", false, false],
      ["robot_2", true, true],
    ])
  })

  it("numbers only pending plan steps with targets", () => {
    const scene = buildScene(at(success, 2))
    expect(scene.planSteps.map((step) => step.number)).toEqual([2, 3, 4])
  })

  it("detects route changes by the first points", () => {
    const line = [0, 1, 2, 3].map((x) => ({ position_x_m: x / 10, position_y_m: 0 }))
    expect(isNewRoute([], line)).toBe(true)
    expect(isNewRoute(line, line.slice(1))).toBe(false)
    expect(
      isNewRoute(line, [
        { position_x_m: 0.1, position_y_m: 0 },
        { position_x_m: 0.1, position_y_m: 0.1 },
      ]),
    ).toBe(true)
    expect(isNewRoute(line, [])).toBe(false)
  })
})
