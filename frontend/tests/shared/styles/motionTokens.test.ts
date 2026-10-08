import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { parseDuration } from "@/ui/shared/motion/cssTokens"

const TOKENS_DIR = resolve(process.cwd(), "src/ui/shared/styles/tokens")
const motionCss = readFileSync(resolve(TOKENS_DIR, "motion.css"), "utf8")
const keyframesCss = readFileSync(resolve(TOKENS_DIR, "keyframes.css"), "utf8")
const ALLOWED_KEYFRAME_PROPERTIES = new Set(["opacity", "transform", "clip-path", "filter"])

function declarations(block: string): Map<string, string> {
  const pattern = /(--[\w-]+):\s*([^;]+);/g
  return new Map([...block.matchAll(pattern)].map((match) => [match[1] ?? "", match[2] ?? ""]))
}

const reducedStart = motionCss.indexOf("@media (prefers-reduced-motion: reduce)")
const rootTokens = declarations(motionCss.slice(0, reducedStart))
const reducedBlock = motionCss.slice(reducedStart)
const reducedRoot = declarations(reducedBlock.slice(0, reducedBlock.indexOf("[data-motion")))
const durationTokens = [...rootTokens.keys()].filter((token) => token.startsWith("--dur-"))
const durationOf = (token: string) => parseDuration(rootTokens.get(token) ?? "")

describe("motion tokens", () => {
  it("uses the curves from the rules verbatim", () => {
    expect(rootTokens.get("--ease-out")).toBe("cubic-bezier(0.23, 1, 0.32, 1)")
    expect(rootTokens.get("--ease-in-out")).toBe("cubic-bezier(0.77, 0, 0.175, 1)")
    expect(rootTokens.get("--ease-drawer")).toBe("cubic-bezier(0.32, 0.72, 0, 1)")
    expect(rootTokens.has("--ease-in")).toBe(false)
  })

  it("compresses every duration to 1ms under reduced motion", () => {
    expect(durationTokens.length).toBeGreaterThan(8)
    for (const token of durationTokens) expect(reducedRoot.get(token), token).toBe("1ms")
    expect(reducedRoot.get("--stagger")).toBe("0ms")
    expect(reducedRoot.get("--press-scale")).toBe("1")
  })

  it("keeps the reduced fade visible", () => {
    expect(parseDuration(rootTokens.get("--reduced-fade") ?? "")).toBeGreaterThan(100)
    expect(reducedBlock).toContain('[data-motion="fade"]')
  })

  it("makes every exit faster than its entrance", () => {
    for (const token of durationTokens.filter((name) => name.endsWith("-exit"))) {
      const entrance = token === "--dur-exit" ? "--dur-base" : token.replace(/-exit$/, "")
      expect(durationOf(token), token).toBeLessThan(durationOf(entrance))
    }
  })

  it("points every --motion-* at an existing keyframe", () => {
    const keyframes = new Set(
      [...keyframesCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]),
    )
    const motions = [...rootTokens].filter(([token]) => token.startsWith("--motion-"))
    expect(motions.length).toBeGreaterThan(10)
    for (const [token, value] of motions) {
      const name = value.trim().split(/\s+/)[0]
      expect(keyframes.has(name), token).toBe(true)
    }
  })

  it("animates only compositor-friendly properties in keyframes", () => {
    const properties = [...keyframesCss.matchAll(/^\s+([a-z-]+):/gm)].map(
      (match) => match[1] ?? "",
    )
    for (const property of properties)
      expect(ALLOWED_KEYFRAME_PROPERTIES.has(property), property).toBe(true)
  })
})
