import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fixtureMap } from "../../../src/adapters/fixture/baseline"
import { buildScript, FIXTURE_SCENARIOS } from "../../../src/adapters/fixture/catalog"
import { createFrameLoop } from "../../../src/ui/features/map/animation/loop"
import { linear } from "../../../src/ui/features/map/easing"
import { cellRole, fillCells } from "../../../src/ui/features/map/layers/grid"
import { appearMark } from "../../../src/ui/features/map/layers/hazards"
import { LabelSink } from "../../../src/ui/features/map/layers/labels"
import { pathLength, tracePrefix } from "../../../src/ui/features/map/layers/paths"
import { samplePop } from "../../../src/ui/features/map/layers/samples"
import {
  MAP_ROLES,
  readMapPalette,
  readMapTimings,
} from "../../../src/ui/features/map/mapTheme"
import { MapRenderer, type MapTheme } from "../../../src/ui/features/map/renderer"
import { buildScene } from "../../../src/ui/features/map/scene"
import { fakeContext, installFakeDocument, removeFakeDocument } from "./fakeCanvas"

const palette = readMapPalette()
const theme: MapTheme = {
  palette,
  timings: {
    drawMs: 900,
    eventMs: 320,
    fadeMs: 200,
    minTrackMs: 160,
    maxTrackMs: 900,
    scanMs: 1540,
    scanTravelMs: 900,
    easing: linear,
  },
  font: "600 12px sans-serif",
  stepFont: "600 16px sans-serif",
}
const text = { terrain: () => "terrain", hazard: (hits: number) => `hazard ${hits}` }

describe("map layers: pure parts", () => {
  it("maps occupancy values to roles and fills pixels", () => {
    expect([cellRole(100), cellRole(0), cellRole(-1), cellRole(42)]).toEqual([
      "obstacle",
      "free",
      "unknown",
      "unknown",
    ])
    const pixels = new Uint8ClampedArray(8)
    fillCells(pixels, [100, 0], palette)
    expect([...pixels.slice(0, 3)]).toEqual(palette.rgba.obstacle.slice(0, 3))
    expect(pixels[7]).toBe(255)
  })

  it("thins the hazard ring and grows it while it fades", () => {
    expect(appearMark(0)).toEqual({ widthPx: 6, growth: 1, alpha: 1 })
    expect(appearMark(1)).toEqual({ widthPx: 1.5, growth: 1.35, alpha: 0 })
  })

  it("pops a sample from a smaller scale and fades its ring", () => {
    expect(samplePop(0)).toMatchObject({ scale: 0.6, opacity: 0, ringAlpha: 1 })
    expect(samplePop(1)).toMatchObject({ scale: 1, opacity: 1, ringAlpha: 0 })
  })

  it("measures and traces a path prefix", () => {
    const coords = new Float64Array([0, 0, 3, 4, 3, 10])
    expect(pathLength(coords)).toBe(11)
    const { context, calls } = fakeContext()
    tracePrefix(context, coords, 7.5)
    expect(calls.map((call) => call.name)).toEqual(["beginPath", "moveTo", "lineTo", "lineTo"])
    expect(calls[3]?.args).toEqual([3, 6.5])
  })

  it("skips overlapping labels", () => {
    const { context, calls } = fakeContext()
    const sink = new LabelSink()
    sink.begin(context, theme.font)
    sink.add(context, "first", 50, 50, "black")
    sink.add(context, "first", 52, 52, "black")
    sink.add(context, "far", 200, 50, "black")
    sink.flush(context, "white")
    expect(
      calls.filter((call) => call.name === "fillText").map((call) => call.args[0]),
    ).toEqual(["first", "far"])
  })

  it("covers every canvas role and zeroes timings under reduced motion", () => {
    expect(Object.keys(palette.css)).toEqual([...MAP_ROLES])
    expect(readMapTimings(true)).toMatchObject({
      drawMs: 0,
      eventMs: 0,
      fadeMs: 0,
      maxTrackMs: 0,
    })
  })
})

describe("map renderer", () => {
  beforeAll(installFakeDocument)
  afterAll(removeFakeDocument)

  it.each(FIXTURE_SCENARIOS)("draws every frame of %s", (name) => {
    const { context } = fakeContext()
    const renderer = new MapRenderer(context, theme, text)
    renderer.setViewport({ width: 960, height: 640 })
    renderer.setMap(fixtureMap)
    buildScript(name).frames.forEach((frame, index) => {
      renderer.setScene(buildScene({ ...frame, run_id: "run" }), index * 500)
      expect(() => renderer.render(index * 500 + 16)).not.toThrow()
    })
  })

  it("asks for frames only while something moves", () => {
    const { context } = fakeContext()
    const renderer = new MapRenderer(context, theme, text)
    renderer.setViewport({ width: 960, height: 640 })
    renderer.setMap(fixtureMap)
    const frames = buildScript("success").frames.map((frame) => ({ ...frame, run_id: "run" }))
    renderer.setScene(buildScene(frames[5] ?? null), 0)
    renderer.render(5000)
    renderer.setScene(buildScene(frames[6] ?? null), 5500)
    expect(renderer.render(5600)).toBe(true)
    expect(renderer.render(9000)).toBe(false)
  })

  it("skips drawing without a map or viewport", () => {
    const { context, calls } = fakeContext()
    const renderer = new MapRenderer(context, theme, text)
    expect(renderer.render(0)).toBe(false)
    expect(calls.map((call) => call.name)).toEqual(["clearRect"])
  })
})

describe("map frame loop", () => {
  it("keeps requesting frames until the step settles", () => {
    const queue: Array<(now: number) => void> = []
    const loop = createFrameLoop((now) => now < 32, {
      request: (callback) => queue.push(callback),
      cancel: () => undefined,
    })
    loop.wake()
    loop.wake()
    expect(queue).toHaveLength(1)
    for (const now of [0, 16, 32]) queue.shift()?.(now)
    expect(queue).toHaveLength(0)
    expect(loop.running).toBe(false)
  })
})
