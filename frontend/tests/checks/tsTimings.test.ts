import { describe, expect, it } from "vitest"
import { tsTimings } from "../../scripts/checks/rules/tsTimings.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const script = (ts: string) => file("src/ui/features/map/layer.ts", ts)

describe("ts-timings", () => {
  it("passes timings read from tokens and zero delays", () => {
    const ts = [
      'setTimeout(close, motionMs("--dur-base"))',
      "const NONE = 0",
      "window.setTimeout(run, NONE)",
      'el.animate(k, { duration: motionMs("--dur-fast"), easing: readEasing("--ease-out") })',
    ].join("\n")
    expect(tsTimings.run([script(ts)])).toEqual([])
  })

  it("reports literal milliseconds in timers and animation options", () => {
    const ts = "window.setTimeout(close, 220)\nel.animate(k, { duration: 200, delay: 40 })\n"
    expect(tsTimings.run([script(ts)])).toHaveLength(3)
  })

  it("resolves constants and arithmetic and checks every WAAPI entry", () => {
    const ts = [
      "const SETTLE = 220",
      "window.setTimeout(done, SETTLE)",
      "window.setTimeout(done, 2 * 110)",
      "el.animate(k, 200)",
      "new KeyframeEffect(el, k, 300)",
      'el.animate(k, { duration: motionMs("--dur-fast"), easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" })',
    ].join("\n")
    expect(tsTimings.run([script(ts)]).map((item) => item.message)).toEqual([
      "setTimeout with a literal delay",
      "setTimeout with a literal delay",
      "animate with a literal duration",
      "KeyframeEffect with a literal duration",
      "literal easing",
    ])
  })

  it("leaves network timeouts outside the interface alone", () => {
    expect(tsTimings.run([file("src/adapters/poll.ts", "setInterval(tick, 1000)\n")])).toEqual(
      [],
    )
  })
})
