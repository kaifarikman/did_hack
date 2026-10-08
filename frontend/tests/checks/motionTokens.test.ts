import { describe, expect, it } from "vitest"
import { curveProblem, motionTokens } from "../../scripts/checks/rules/motionTokens.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const tokens = (name: string, text: string): SourceFile => ({
  path: `src/ui/shared/styles/tokens/${name}`,
  text,
})
const KEYFRAMES = tokens(
  "keyframes.css",
  "@keyframes kf-in {\n  from {\n    opacity: 0;\n  }\n}\n",
)
const motion = (root: string, reduced = "") =>
  tokens(
    "motion.css",
    `:root { ${root} }\n@media (prefers-reduced-motion: reduce) { :root { ${reduced} } }`,
  )
const messages = (...files: SourceFile[]) => motionTokens.run(files).map((item) => item.message)

describe("motion-tokens", () => {
  it("passes consistent motion tokens", () => {
    const files = [
      KEYFRAMES,
      motion(
        "--ease-out: cubic-bezier(0.23, 1, 0.32, 1); --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); --dur-base: 200ms; --dur-exit: 140ms; --motion-in: kf-in var(--dur-base); --transition-fade: opacity var(--dur-base) var(--ease-out);",
        "--dur-base: 1ms; --dur-exit: 1ms;",
      ),
    ]
    expect(messages(...files)).toEqual([])
  })

  it("reports slow exits, ease-in, missing keyframes and uncompressed durations", () => {
    const files = [
      KEYFRAMES,
      motion(
        "--dur-base: 200ms; --dur-exit: 240ms; --ease-in: ease-in; --motion-in: kf-out 1s;",
        "--dur-base: 1ms;",
      ),
    ]
    expect(messages(...files)).toEqual([
      "--dur-exit is not 1ms under reduced motion",
      "--dur-exit is not shorter than --dur-base",
      "--ease-in: ease-in keyword",
      "--motion-in points to a missing keyframe",
      "--ease-in must not exist",
    ])
  })

  it("judges curves by shape, not by name", () => {
    expect(curveProblem([0.4, 0, 1, 1])).toBe("ease-in curve")
    expect(curveProblem([0.34, 1.56, 0.64, 1])).toBe("overshooting (bounce) curve")
    expect(curveProblem([0.23, 1, 0.32, 1])).toBeNull()
    const files = [
      KEYFRAMES,
      motion(
        "--ease-enter: cubic-bezier(0.4, 0, 1, 1); --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);",
      ),
    ]
    expect(messages(...files)).toHaveLength(2)
  })

  it("checks the properties inside --transition-* tokens", () => {
    const files = [KEYFRAMES, motion("--transition-grow: width 1ms;")]
    expect(messages(...files)).toEqual(["--transition-grow transitions width"])
  })

  it("parses one-line keyframes and resolves scale and blur through tokens", () => {
    const keyframes = tokens(
      "keyframes.css",
      "@keyframes probe-flat { from { height: 0; } to { height: 10px; } }\n@keyframes probe-zero {\n  from {\n    transform: scale(0.0);\n    filter: blur(var(--blur));\n  }\n}\n",
    )
    expect(messages(keyframes, motion("--blur: 12px;"))).toEqual([
      "@keyframes probe-flat animates height",
      "@keyframes probe-zero starts from scale(0)",
      "@keyframes probe-zero blurs more than 2px",
    ])
  })

  it("reports long UI durations but allows rare-event tokens", () => {
    const files = [
      KEYFRAMES,
      motion("--dur-panel: 320ms; --dur-draw: 900ms;", "--dur-panel: 1ms; --dur-draw: 1ms;"),
    ]
    expect(messages(...files)).toEqual(["--dur-panel is 300ms or longer for UI"])
  })

  it("reports missing motion files instead of passing silently", () => {
    expect(messages(KEYFRAMES)).toHaveLength(1)
  })
})
