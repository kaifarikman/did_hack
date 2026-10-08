import { describe, expect, it } from "vitest"
import {
  interpolatePose,
  lerpAngle,
  progress,
  shortestAngle,
  trackDuration,
} from "../../../src/ui/features/map/animation/interpolate"
import { mixColor, parseColor, toCss } from "../../../src/ui/features/map/color"
import { cubicBezier, linear, parseEasing } from "../../../src/ui/features/map/easing"

describe("map interpolation", () => {
  it("clamps progress and treats zero duration as finished", () => {
    expect(progress(50, 0, 100)).toBe(0.5)
    expect(progress(-10, 0, 100)).toBe(0)
    expect(progress(500, 0, 100)).toBe(1)
    expect(progress(0, 0, 0)).toBe(1)
  })

  it("turns through the shortest angle", () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6)
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + (2 * Math.PI - 6) / 2)
  })

  it("interpolates a pose in place", () => {
    const target = { position_x_m: 0, position_y_m: 0, heading_rad: 0 }
    const from = { position_x_m: 0, position_y_m: 0, heading_rad: 0 }
    const to = { position_x_m: 2, position_y_m: -1, heading_rad: Math.PI / 2 }
    const result = interpolatePose(target, from, to, 0.5)
    expect(result).toBe(target)
    expect(result).toEqual({ position_x_m: 1, position_y_m: -0.5, heading_rad: Math.PI / 4 })
  })

  it("keeps the track duration between token bounds, zero under reduced motion", () => {
    expect(trackDuration(500, 160, 900)).toBe(500)
    expect(trackDuration(20, 160, 900)).toBe(160)
    expect(trackDuration(5000, 160, 900)).toBe(900)
    expect(trackDuration(500, 0, 0)).toBe(0)
  })
})

describe("map easing", () => {
  it("solves cubic-bezier curves with fixed endpoints", () => {
    const easeOut = cubicBezier(0.23, 1, 0.32, 1)
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.8)
    const samples = [0.1, 0.2, 0.4, 0.6, 0.8].map(easeOut)
    expect(samples).toEqual([...samples].sort((first, second) => first - second))
  })

  it("parses css easing and falls back to linear", () => {
    expect(parseEasing("cubic-bezier(0.23, 1, 0.32, 1)")(0.5)).toBeGreaterThan(0.8)
    expect(parseEasing("steps(4)")).toBe(linear)
  })
})

describe("map colors", () => {
  it("parses hex and rgb strings", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1])
    expect(parseColor("#64d5b3")).toEqual([100, 213, 179, 1])
    expect(parseColor("rgba(86, 89, 89, 0.5)")).toEqual([86, 89, 89, 0.5])
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5])
    expect(parseColor("teal")).toBeNull()
  })

  it("mixes colors and prints css", () => {
    expect(mixColor([0, 0, 0, 1], [255, 255, 255, 0], 0.5)).toEqual([127.5, 127.5, 127.5, 0.5])
    expect(toCss([10, 20, 30, 0.25])).toBe("rgba(10, 20, 30, 0.25)")
  })
})
