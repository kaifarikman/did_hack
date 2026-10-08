import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Meter, Stat, VerdictMark } from "@/ui/shared/ui"
import { VERDICT_ICON } from "@/ui/shared/ui/verdict-mark"
import { ruleBody } from "../../setup/styleRules"

const css = (component: string) =>
  readFileSync(
    resolve(process.cwd(), `src/ui/shared/ui/${component}/styles.module.css`),
    "utf8",
  )

describe("telemetry frequency", () => {
  it("does not animate stat numbers that change every tick", () => {
    const { rerender } = render(<Stat label="battery" value="82" unit="%" />)
    rerender(<Stat label="battery" value="81" unit="%" />)
    const value = screen.getByText("81")
    expect(value.closest("[data-swap]")).toBeNull()
    expect(value.closest("[data-motion]")).toBeNull()
    for (const selector of [".value", ".figure", ".stat"]) {
      expect(ruleBody(css("stat"), selector)).not.toMatch(/animation|transition/)
    }
  })

  it("moves the meter bar only through scale and keeps its reading static", () => {
    const { container } = render(<Meter label="battery" value={0.5} valueText="50%" />)
    expect(container.querySelector("[data-swap]")).toBeNull()
    expect(ruleBody(css("meter"), ".fill")).toContain("transition: var(--transition-meter)")
    expect(ruleBody(css("meter"), ".reading")).not.toMatch(/animation|transition/)
  })
})

describe("verdicts", () => {
  const verdicts = ["confirmed", "refuted", "inconclusive"] as const

  it("give every outcome its own icon", () => {
    expect(new Set(verdicts.map((verdict) => VERDICT_ICON[verdict])).size).toBe(verdicts.length)
    for (const verdict of verdicts) {
      const { container } = render(<VerdictMark verdict={verdict} label={verdict} />)
      expect(container.querySelector(`[data-icon='${VERDICT_ICON[verdict]}']`)).not.toBeNull()
    }
  })

  it("give every outcome its own motion", () => {
    const animations = verdicts.map(
      (verdict) =>
        /animation: (var\(--motion-[\w-]+\))/.exec(
          ruleBody(css("verdict-mark"), `.${verdict}`),
        )?.[1],
    )
    expect(animations.every((animation) => animation !== undefined)).toBe(true)
    expect(new Set(animations).size).toBe(verdicts.length)
  })

  it("keeps a reduced-motion fade", () => {
    render(<VerdictMark verdict="refuted" label="refuted" />)
    expect(screen.getByText("refuted").parentElement?.dataset.motion).toBe("fade")
  })
})
