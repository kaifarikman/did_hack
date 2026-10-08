import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { READY_HEALTH } from "@/adapters/fixture/baseline"
import { IDLE_COMMAND } from "@/application/viewState"
import { CommandBanner } from "@/ui/features/mission/command-banner"
import { MissionForm } from "@/ui/features/mission/mission-form"
import { MissionStats } from "@/ui/features/mission/mission-stats"
import { RunSummary } from "@/ui/features/mission/run-summary"
import { applyMotionTokens } from "../../setup/motionEnvironment"
import { renderWithLocale } from "./render"
import { RUN_STATUSES_FOR_TEST } from "./statuses"
import { controllerSpy, findFrame, frame, RU, viewOf } from "./views"

describe("MissionStats", () => {
  it.each(RUN_STATUSES_FOR_TEST)("shows the %s status in a badge", (status) => {
    renderWithLocale(<MissionStats snapshot={{ ...frame("success", 5), status }} />)
    expect(screen.getByText(RU.mission.status[status])).toBeTruthy()
  })

  it("changes the status badge through Swap", () => {
    applyMotionTokens()
    const { container, rerender } = renderWithLocale(
      <MissionStats snapshot={{ ...frame("success", 5), status: "running" }} />,
    )
    rerender(<MissionStats snapshot={{ ...frame("success", 5), status: "returning" }} />)
    expect(container.querySelector("[data-swap='out']")).not.toBeNull()
  })

  it("marks the battery below the return reserve", () => {
    const low = findFrame(
      "hard_events",
      (item) =>
        item.battery_remaining !== null &&
        item.return_energy_estimate !== null &&
        item.battery_remaining < item.return_energy_estimate,
    )
    const { container, rerender } = renderWithLocale(
      <MissionStats snapshot={frame("hard_events", 5)} />,
    )
    expect(container.querySelector(".flash")).toBeNull()
    rerender(<MissionStats snapshot={low} />)
    expect(container.querySelector("[data-tone='attention']")).not.toBeNull()
    expect(container.querySelector(".flash")).not.toBeNull()
  })

  it("shows the no-value dash for a missing signal and goal", () => {
    const { container } = renderWithLocale(<MissionStats snapshot={frame("success", 0)} />)
    expect(screen.getByText(RU.mission.goal.none)).toBeTruthy()
    expect(container.querySelectorAll("[data-no-value]").length).toBeGreaterThan(0)
  })
})

describe("MissionForm", () => {
  it("starts with the chosen options", () => {
    const starts: unknown[] = []
    renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: frame("success", -1) })}
        onStart={(request) => starts.push(request)}
        onStop={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: RU.mission.scenario.hard }))
    fireEvent.click(screen.getByRole("button", { name: RU.mission.action.start }))
    expect(starts).toEqual([
      { seed: 42, scenario: "hard", missionText: "", mapMode: "static", robotCount: 1 },
    ])
  })

  it("explains why Start is blocked while the environment starts", () => {
    const view = viewOf({
      snapshot: frame("success", -1),
      health: { ...READY_HEALTH, status: "starting" },
    })
    renderWithLocale(
      <MissionForm view={view} onStart={() => undefined} onStop={() => undefined} />,
    )
    const start = screen.getByRole("button", { name: RU.mission.action.start })
    expect(start.getAttribute("aria-disabled")).toBe("true")
    fireEvent.focus(start)
    expect(
      screen.getAllByText(RU.mission.blocker.start.environmentStarting).length,
    ).toBeGreaterThan(0)
  })

  it("disables options the environment does not support", () => {
    const view = viewOf({
      snapshot: frame("success", -1),
      health: {
        ...READY_HEALTH,
        supported_scenarios: ["easy"],
        supported_robot_counts: [1],
      },
    })
    renderWithLocale(
      <MissionForm view={view} onStart={() => undefined} onStop={() => undefined} />,
    )
    expect(
      screen.getByRole("radio", { name: RU.mission.scenario.medium }).hasAttribute("disabled"),
    ).toBe(true)
    expect(screen.getByRole("radio", { name: "2" }).hasAttribute("disabled")).toBe(true)
  })

  it("keeps a blocked Start focusable and does not submit", () => {
    const starts: string[] = []
    const view = viewOf({
      snapshot: frame("success", -1),
      health: { ...READY_HEALTH, status: "starting" },
    })
    renderWithLocale(
      <MissionForm view={view} onStart={() => starts.push("start")} onStop={() => undefined} />,
    )
    const start = screen.getByRole("button", { name: RU.mission.action.start })
    expect(start.hasAttribute("disabled")).toBe(false)
    fireEvent.click(start)
    expect(starts).toEqual([])
    expect(screen.getByText(RU.mission.blocker.start.environmentStarting)).toBeTruthy()
  })

  it("keeps only the actions while a run is active", () => {
    renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: frame("success", 5) })}
        compact
        onStart={() => undefined}
        onStop={() => undefined}
      />,
    )
    expect(screen.queryByRole("radio", { name: RU.mission.scenario.easy })).toBeNull()
    expect(screen.getByRole("button", { name: RU.mission.action.stop })).toBeTruthy()
  })

  it("allows Stop only for an active run", () => {
    const stops: string[] = []
    renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: frame("success", 5) })}
        onStart={() => undefined}
        onStop={() => stops.push("stop")}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: RU.mission.action.stop }))
    expect(stops).toEqual(["stop"])
  })
})

describe("CommandBanner", () => {
  it("offers a retry only after reconciliation", () => {
    const { controller, calls } = controllerSpy()
    const unknown = { ...IDLE_COMMAND, phase: "unknown" as const, kind: "stop" as const }
    const { rerender } = renderWithLocale(
      <CommandBanner command={unknown} controller={controller} />,
    )
    expect(screen.getByText(RU.mission.command.unknown)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: RU.mission.action.retry }).hasAttribute("disabled"),
    ).toBe(true)
    rerender(<CommandBanner command={{ ...unknown, canRetry: true }} controller={controller} />)
    fireEvent.click(screen.getByRole("button", { name: RU.mission.action.retry }))
    expect(screen.getByText(RU.mission.command.reconciled)).toBeTruthy()
    expect(calls).toEqual(["retryCommand()"])
  })

  it("shows a failed command as critical", () => {
    const { controller } = controllerSpy()
    renderWithLocale(
      <CommandBanner
        command={{ ...IDLE_COMMAND, phase: "failed", kind: "start" }}
        controller={controller}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(within(alert).getByText(RU.mission.command.failed)).toBeTruthy()
  })
})

describe("RunSummary", () => {
  it("appears only when the run is finished", () => {
    const { container, rerender } = renderWithLocale(
      <RunSummary snapshot={frame("success", 5)} />,
    )
    expect(container.textContent).toBe("")
    rerender(<RunSummary snapshot={frame("success", -1)} />)
    expect(screen.getByText(RU.mission.outcome.success)).toBeTruthy()
    rerender(<RunSummary snapshot={{ ...frame("failed", -1), team: null }} />)
    expect(screen.getByText(RU.mission.outcome.failure)).toBeTruthy()
  })
})
