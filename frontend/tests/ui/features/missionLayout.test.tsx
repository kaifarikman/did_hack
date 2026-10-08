import { act, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildScript } from "@/adapters/fixture/catalog"
import type { MissionSnapshot } from "@/domain/contract"
import { missionLayoutOf } from "@/ui/features/mission/layout"
import { MissionCard } from "@/ui/features/mission/mission-card"
import { applyMotionTokens } from "../../setup/motionEnvironment"
import { renderWithLocale } from "./render"
import { controllerSpy, frame, RU, viewOf } from "./views"

describe("mission layout", () => {
  it("splits the card into setup, run and summary", () => {
    expect(missionLayoutOf(null)).toBe("setup")
    expect(missionLayoutOf(buildScript("success").idle)).toBe("setup")
    expect(missionLayoutOf(frame("success", 5))).toBe("run")
    expect(missionLayoutOf(frame("success", -1))).toBe("summary")
  })

  it("hides the setup fields during a run and shows the summary after it", async () => {
    const { controller } = controllerSpy()
    const card = (index: number) => (
      <MissionCard
        view={viewOf({ snapshot: frame("success", index) })}
        controller={controller}
        motionIndex={0}
      />
    )
    const { rerender } = renderWithLocale(card(5))
    expect(screen.queryByRole("radio", { name: RU.mission.scenario.easy })).toBeNull()
    expect(screen.queryByText(RU.mission.summary.title)).toBeNull()
    await act(async () => {
      rerender(card(-1))
    })
    expect(screen.getByText(RU.mission.summary.title)).toBeTruthy()
    expect(screen.getByRole("radio", { name: RU.mission.scenario.easy })).toBeTruthy()
  })
})

describe("mission loading", () => {
  it("shows the skeleton only after the delay and holds it before the stats", async () => {
    vi.useFakeTimers()
    applyMotionTokens()
    const { controller } = controllerSpy()
    const card = (snapshot: MissionSnapshot | null) => (
      <MissionCard view={viewOf({ snapshot })} controller={controller} motionIndex={0} />
    )
    const { container, rerender } = renderWithLocale(card(null))
    expect(container.querySelector("[data-skeleton]")).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(container.querySelector("[data-skeleton]")).not.toBeNull()
    rerender(card(frame("success", 5)))
    expect(container.querySelector("[data-skeleton]")).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelector("[data-skeleton]")).toBeNull()
    expect(screen.getByText(RU.mission.metric.time)).toBeTruthy()
    vi.useRealTimers()
  })
})
