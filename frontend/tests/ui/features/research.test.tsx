import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PlanView } from "@/ui/features/research/plan-view"
import { ResearchCard } from "@/ui/features/research/research-card"
import { SensorView } from "@/ui/features/research/sensor-view"
import { applyMotionTokens } from "../../setup/motionEnvironment"
import { renderWithLocale } from "./render"
import { findFrame, frame, RU } from "./views"

describe("PlanView", () => {
  it("shows every step status after a revision", () => {
    const revised = findFrame("plan_revision", (item) => item.plan?.revision_reason != null)
    const { container } = renderWithLocale(<PlanView plan={revised.plan} />)
    const statuses = [...container.querySelectorAll("[data-status]")].map((item) =>
      item.getAttribute("data-status"),
    )
    expect(statuses).toEqual(expect.arrayContaining(["done", "rejected", "dropped", "pending"]))
    expect(screen.getByText(RU.research.label.revision)).toBeTruthy()
  })

  it("swaps the old plan out when a new plan arrives and pops done steps", () => {
    applyMotionTokens()
    const first = findFrame("plan_revision", (item) => item.plan !== null)
    const revised = findFrame("plan_revision", (item) => item.plan?.revision_reason != null)
    const { container, rerender } = renderWithLocale(<PlanView plan={first.plan} />)
    rerender(<PlanView plan={revised.plan} />)
    expect(container.querySelector("[data-swap='out']")).not.toBeNull()
  })

  it("explains a fallback plan", () => {
    const fallback = findFrame("llm_fallback", (item) => item.plan?.source === "fallback")
    renderWithLocale(<PlanView plan={fallback.plan} />)
    expect(screen.getByText(RU.research.source.fallback)).toBeTruthy()
    expect(screen.getByText(RU.research.label.fallbackReason)).toBeTruthy()
  })

  it("shows an empty state without a plan", () => {
    renderWithLocale(<PlanView plan={null} />)
    expect(screen.getByText(RU.research.label.noPlan)).toBeTruthy()
  })
})

describe("SensorView", () => {
  it.each(["noise", "stuck", "dropout"] as const)(
    "names the %s fault while degraded",
    (fault) => {
      const degraded = findFrame(
        "hard_events",
        (item) =>
          item.research?.sensor.state === "degraded" && item.research.sensor.fault === fault,
      )
      if (degraded.research === null) throw new Error("research expected")
      const { container } = renderWithLocale(<SensorView research={degraded.research} />)
      expect(screen.getByText(RU.research.sensor.degraded)).toBeTruthy()
      expect(screen.getByText(RU.research.fault[fault])).toBeTruthy()
      expect(container.querySelector("[data-state='degraded']")).not.toBeNull()
    },
  )
})

describe("ResearchCard", () => {
  it("lists hazards and hypothesis verdicts", () => {
    const late = frame("medium_adaptation", -1)
    const { container } = renderWithLocale(<ResearchCard snapshot={late} motionIndex={0} />)
    expect(container.querySelector("[data-verdict='refuted']")).not.toBeNull()
    expect(container.querySelector("[data-verdict='confirmed']")).not.toBeNull()
    expect(container.querySelector("[data-regime='1']")).not.toBeNull()
  })

  it("shows empty hazards before any were observed", () => {
    renderWithLocale(<ResearchCard snapshot={frame("success", 5)} motionIndex={0} />)
    expect(screen.getByText(RU.research.label.noHazards)).toBeTruthy()
  })
})
