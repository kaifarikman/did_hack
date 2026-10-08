import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  motionMs,
  parseDuration,
  readEasing,
  staggerStyle,
  useReducedMotion,
} from "@/ui/shared/motion"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"

describe("css token readers", () => {
  it("parses durations in ms and s", () => {
    expect(parseDuration("200ms")).toBe(200)
    expect(parseDuration(" 0.32s ")).toBe(320)
    expect(parseDuration("")).toBe(0)
    expect(parseDuration("fast")).toBe(0)
  })

  it("reads durations and easing from the document", () => {
    applyMotionTokens()
    expect(motionMs("--dur-base")).toBe(200)
    expect(motionMs("--delay-skeleton")).toBe(200)
    expect(readEasing("--ease-out")).toBe("cubic-bezier(0.23, 1, 0.32, 1)")
  })

  it("falls back to linear easing when the token is missing", () => {
    expect(readEasing("--ease-drawer")).toBe("linear")
  })

  it("builds a stagger style from an index", () => {
    expect(staggerStyle(3)).toEqual({ "--i": 3 })
    expect(staggerStyle(-2)).toEqual({ "--i": 0 })
  })
})

describe("useReducedMotion", () => {
  it("is false without matchMedia", () => {
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false)
  })

  it("follows the media query", () => {
    setReducedMotion(true)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })
})
