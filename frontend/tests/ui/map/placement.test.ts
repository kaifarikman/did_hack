import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fixtureMap } from "../../../src/adapters/fixture/baseline"
import { buildScript } from "../../../src/adapters/fixture/catalog"
import { createViewTransform } from "../../../src/domain/geometry"
import { MapMotion } from "../../../src/ui/features/map/animation/motion"
import { linear } from "../../../src/ui/features/map/easing"
import { legendPresence, visibleLegend } from "../../../src/ui/features/map/labels"
import type { LayerFrame } from "../../../src/ui/features/map/layers/frame"
import { LabelSink } from "../../../src/ui/features/map/layers/labels"
import { drawBase, placeMarks } from "../../../src/ui/features/map/layers/markers"
import { reservationRadius } from "../../../src/ui/features/map/layers/robots"
import { readMapPalette } from "../../../src/ui/features/map/mapTheme"
import { MapRenderer } from "../../../src/ui/features/map/renderer"
import { buildScene, EMPTY_SCENE, type MapScene } from "../../../src/ui/features/map/scene"
import { fakeContext, installFakeDocument, removeFakeDocument } from "./fakeCanvas"

const TIMINGS = {
  drawMs: 0,
  eventMs: 0,
  fadeMs: 0,
  minTrackMs: 0,
  maxTrackMs: 0,
  easing: linear,
}
const palette = readMapPalette()
const text = { terrain: () => "terrain", hazard: (hits: number) => `hazard ${hits}` }
const transform = createViewTransform(fixtureMap, { width: 960, height: 640 })

const callLog = new WeakMap<LayerFrame, { name: string }[]>()

function fakeCalls(frame: LayerFrame): string[] {
  return (callLog.get(frame) ?? []).map((call) => call.name)
}

function frameFor(scene: MapScene): LayerFrame {
  const { context, calls } = fakeContext()
  const motion = new MapMotion(TIMINGS)
  motion.update(scene, 0)
  motion.advance(1)
  const labels = new LabelSink()
  labels.begin(context, "600 12px sans-serif")
  const frame = {
    context,
    transform,
    palette,
    motion,
    scene,
    labels,
    text,
    now: 1,
    easing: linear,
  }
  calls.length = 0
  callLog.set(frame, calls)
  return frame
}

const at = (x: number, y: number) => ({ position_x_m: x, position_y_m: y })

describe("label placement", () => {
  it("treats markers as obstacles", () => {
    const { context } = fakeContext()
    const sink = new LabelSink()
    sink.begin(context, "600 12px sans-serif")
    sink.reserve(5, 5, 4, 4)
    expect(sink.isFree(0, 0, 10, 10)).toBe(false)
    expect(sink.isFree(20, 20, 10, 10)).toBe(true)
  })

  it("moves a label to its alternate position when the first one is taken", () => {
    const { context, calls } = fakeContext()
    const sink = new LabelSink()
    sink.begin(context, "600 12px sans-serif")
    sink.reserveAround(100, 90, 12)
    expect(sink.add(context, "hazard", 100, 100, "red", 140)).toBe(true)
    sink.flush(context, "white")
    const fill = calls.find((call) => call.name === "fillText")
    expect(Number(fill?.args[2])).toBeGreaterThan(120)
  })

  it("drops a label that has no free place", () => {
    const { context } = fakeContext()
    const sink = new LabelSink()
    sink.begin(context, "600 12px sans-serif")
    sink.reserve(0, 0, 400, 400)
    expect(sink.add(context, "terrain", 100, 100, "black", 200)).toBe(false)
  })
})

describe("plan step markers", () => {
  it("moves a step off the base and keeps the others apart", () => {
    const base = at(-2, -0.5)
    const scene: MapScene = {
      ...EMPTY_SCENE,
      base,
      planSteps: [
        { number: 1, target: base },
        { number: 2, target: base },
      ],
    }
    const marks = placeMarks(frameFor(scene))
    expect(marks.map((mark) => mark.moved)).toEqual([true, true])
    const [first, second] = marks
    if (first === undefined || second === undefined) throw new Error("marks expected")
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(20)
  })

  it("keeps a step on its target when nothing is there", () => {
    const scene: MapScene = { ...EMPTY_SCENE, planSteps: [{ number: 1, target: at(0, 0) }] }
    expect(placeMarks(frameFor(scene))[0]?.moved).toBe(false)
  })
})

describe("base marker", () => {
  it("draws a square with a hollow centre and nothing without a base", () => {
    const withBase = frameFor({ ...EMPTY_SCENE, base: at(0, 0) })
    drawBase(withBase)
    expect(fakeCalls(withBase).filter((name) => name === "fillRect")).toHaveLength(2)
    const empty = frameFor(EMPTY_SCENE)
    drawBase(empty)
    expect(fakeCalls(empty).filter((name) => name === "fillRect")).toHaveLength(0)
  })
})

describe("partner reservation", () => {
  it("never reaches past the map bounds", () => {
    const frame = frameFor(EMPTY_SCENE)
    const edge = at(transform.bounds.maxX - 0.05, 0)
    expect(reservationRadius(frame, edge)).toBeLessThanOrEqual(0.1 * transform.scale + 1e-9)
    const inside = at(
      (transform.bounds.minX + transform.bounds.maxX) / 2,
      (transform.bounds.minY + transform.bounds.maxY) / 2,
    )
    expect(reservationRadius(frame, inside)).toBeCloseTo(0.4 * transform.scale, 6)
  })
})

describe("map legend", () => {
  it("lists only the layers that are on the map", () => {
    const idle = buildScene({ ...buildScript("success").idle, run_id: null })
    const roles = visibleLegend(idle, true).map((item) => item.role)
    expect(roles).not.toContain("robotPartner")
    expect(roles).not.toContain("hazard")
    expect(roles).toContain("obstacle")
    const team = buildScene({
      ...(buildScript("team_success").frames[10] ?? buildScript("success").idle),
      run_id: "run",
    })
    expect(legendPresence(team, true).robotPartner).toBe(true)
    expect(visibleLegend(EMPTY_SCENE, false)).toEqual([])
  })
})

describe("SLAM grid", () => {
  beforeAll(installFakeDocument)
  afterAll(removeFakeDocument)

  it("redraws every revision of a growing SLAM map and nothing without a map", () => {
    const script = buildScript("slam_building")
    const grown = script.maps.flatMap((revision) =>
      revision.map === null ? [] : [revision.map],
    )
    expect(grown.length).toBeGreaterThan(1)
    expect(new Set(grown.map((map) => map.map_id)).size).toBe(grown.length)
    expect(script.maps.some((revision) => revision.map === null)).toBe(true)
    const theme = { palette, timings: TIMINGS, font: "12px a", stepFont: "16px a" }
    for (const map of grown) {
      const { context, calls } = fakeContext()
      const renderer = new MapRenderer(context, theme, text)
      renderer.setViewport({ width: 960, height: 640 })
      renderer.setMap(map)
      renderer.render(0)
      expect(calls.some((call) => call.name === "drawImage")).toBe(true)
    }
    const { context, calls } = fakeContext()
    const empty = new MapRenderer(context, theme, text)
    empty.setViewport({ width: 960, height: 640 })
    empty.setMap(null)
    empty.render(0)
    expect(calls.map((call) => call.name)).toEqual(["clearRect"])
  })
})
