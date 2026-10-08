import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  type MissionPlanView,
  type ResearchView,
  SENSOR_FAULTS,
  SENSOR_STATES,
  STEP_STATUSES,
} from "@/domain/contract"
import { PlanView } from "@/ui/features/research/plan-view"
import { ResearchCard } from "@/ui/features/research/research-card"
import { SensorView } from "@/ui/features/research/sensor-view"
import { BACKEND_CONTENT_LANG } from "@/ui/shared/i18n"
import { applyMotionTokens } from "../../setup/motionEnvironment"
import { renderWithLocale } from "./render"
import { findFrame, frame, RU } from "./views"

function researchOf(name: Parameters<typeof frame>[0]): ResearchView {
  const research = findFrame(name, (item) => item.research !== null).research
  if (research === null) throw new Error("research expected")
  return research
}

function planOf(name: Parameters<typeof frame>[0]): MissionPlanView {
  const plan = findFrame(name, (item) => item.plan !== null).plan
  if (plan === null) throw new Error("plan expected")
  return plan
}

describe("PlanView step statuses", () => {
  it.each(STEP_STATUSES)("renders a %s step", (status) => {
    const plan = planOf("success")
    const steps = plan.steps.map((step) => ({ ...step, status }))
    const { container } = renderWithLocale(<PlanView plan={{ ...plan, steps }} />)
    expect(container.querySelectorAll(`[data-status='${status}']`)).toHaveLength(steps.length)
  })

  it("keeps the revise condition apart from the translated label", () => {
    const revised = findFrame("plan_revision", (item) =>
      (item.plan?.steps ?? []).some((step) => step.revise_if !== null),
    )
    const { container } = renderWithLocale(<PlanView plan={revised.plan} />)
    expect(screen.getAllByText(RU.research.label.reviseIf).length).toBeGreaterThan(0)
    const condition = revised.plan?.steps.find((step) => step.revise_if !== null)?.revise_if
    const marked = [...container.querySelectorAll(`[lang='${BACKEND_CONTENT_LANG}']`)].map(
      (node) => node.textContent,
    )
    expect(marked).toContain(condition)
  })
})

describe("SensorView states", () => {
  const base = researchOf("hard_events")
  const cases = SENSOR_STATES.flatMap((state) =>
    [null, ...SENSOR_FAULTS].map((fault) => [state, fault] as const),
  )

  it.each(cases)("shows %s with fault %s and the quality", (state, fault) => {
    const research = { ...base, sensor: { ...base.sensor, state, fault, quality: 0.42 } }
    const { container } = renderWithLocale(<SensorView research={research} />)
    expect(screen.getByText(RU.research.sensor[state])).toBeTruthy()
    if (fault !== null) expect(screen.getByText(RU.research.fault[fault])).toBeTruthy()
    expect(container.querySelector(`[data-state='${state}']`)).not.toBeNull()
    expect(container.querySelector(`[data-fault='${fault ?? "none"}']`)).not.toBeNull()
    expect(container.textContent).toContain("42")
  })

  it("counts planner requests", () => {
    const research = { ...base, planner_requests: 7 }
    renderWithLocale(<SensorView research={research} />)
    expect(screen.getByText(RU.research.label.plannerRequests)).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
  })
})

describe("ResearchCard details", () => {
  it("swaps the last replan reason", () => {
    applyMotionTokens()
    const snapshot = frame("medium_adaptation", -1)
    const research = snapshot.research ?? researchOf("medium_adaptation")
    const first = { ...snapshot, research: { ...research, last_replan_reason: "first" } }
    const second = { ...snapshot, research: { ...research, last_replan_reason: "second" } }
    const { container, rerender } = renderWithLocale(
      <ResearchCard snapshot={first} motionIndex={0} />,
    )
    expect(screen.getByText(RU.research.label.replan)).toBeTruthy()
    rerender(<ResearchCard snapshot={second} motionIndex={0} />)
    expect(container.querySelector("[data-swap='out']")).not.toBeNull()
  })

  it("numbers hazards with a plural hit count", () => {
    const snapshot = findFrame(
      "hard_events",
      (item) => (item.research?.hazards.length ?? 0) > 0,
    )
    const research = snapshot.research ?? researchOf("hard_events")
    const hazard = research.hazards[0]
    if (hazard === undefined) throw new Error("hazard expected")
    const many = { ...snapshot, research: { ...research, hazards: [{ ...hazard, hits: 5 }] } }
    renderWithLocale(<ResearchCard snapshot={many} motionIndex={0} />)
    expect(
      screen.getByText(
        RU.research.label.hazardItem_many.replace("{{index}}", "1").replace("{{count}}", "5"),
      ),
    ).toBeTruthy()
  })

  it("names terrain areas instead of internal ids", () => {
    const snapshot = findFrame("medium_adaptation", (item) => item.terrain_estimates.length > 0)
    renderWithLocale(<ResearchCard snapshot={snapshot} motionIndex={0} />)
    expect(screen.getByText(RU.research.label.region.replace("{{index}}", "1"))).toBeTruthy()
    const id = snapshot.terrain_estimates[0]?.region_id ?? ""
    expect(screen.queryByText(id)).toBeNull()
  })

  it("shows the plan skeleton before the first snapshot", async () => {
    const { container } = renderWithLocale(<ResearchCard snapshot={null} motionIndex={0} />)
    await screen.findByText(RU.research.title)
    await new Promise((resolve) => setTimeout(resolve, 260))
    expect(container.querySelector("[data-skeleton]")).not.toBeNull()
  })
})
