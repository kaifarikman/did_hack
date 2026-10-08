import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { READY_HEALTH } from "@/adapters/fixture/baseline"
import {
  IDLE_COMMAND,
  type MissionViewState,
  START_BLOCKERS,
  STOP_BLOCKERS,
  type StartBlocker,
  type StopBlocker,
  startDisabledReason,
  stopDisabledReason,
} from "@/application/viewState"
import { CommandBanner } from "@/ui/features/mission/command-banner"
import { START_BLOCKER_LABELS, STOP_BLOCKER_LABELS } from "@/ui/features/mission/labels"
import { MissionForm } from "@/ui/features/mission/mission-form"
import { MissionStats } from "@/ui/features/mission/mission-stats"
import { RunSummary } from "@/ui/features/mission/run-summary"
import { renderWithLocale } from "./render"
import { controllerSpy, findFrame, frame, RU, ruText, viewOf } from "./views"

const idle = frame("idle_ready", 0)
const running = frame("success", 5)
const awaiting = { ...IDLE_COMMAND, phase: "awaiting" as const, kind: "start" as const }

const START_VIEWS: Readonly<Record<StartBlocker, MissionViewState>> = {
  no_snapshot: viewOf({ snapshot: null }),
  offline: viewOf({ snapshot: idle, connection: "stale" }),
  health_unknown: viewOf({ snapshot: idle, health: null }),
  environment_starting: viewOf({
    snapshot: idle,
    health: { ...READY_HEALTH, status: "starting" },
  }),
  command_busy: viewOf({ snapshot: idle, command: awaiting }),
  run_active: viewOf({ snapshot: running }),
}

const STOP_VIEWS: Readonly<Record<StopBlocker, MissionViewState>> = {
  no_run: viewOf({ snapshot: { ...idle, run_id: null } }),
  offline: viewOf({ snapshot: running, connection: "stale" }),
  command_busy: viewOf({ snapshot: running, command: { ...awaiting, kind: "stop" } }),
  run_inactive: viewOf({ snapshot: frame("success", -1) }),
  already_stopping: viewOf({ snapshot: { ...running, status: "stopping" } }),
}

describe("Start and Stop blockers in the form", () => {
  it.each(START_BLOCKERS)("explains the %s Start blocker", async (blocker) => {
    const view = START_VIEWS[blocker]
    expect(startDisabledReason(view)).toBe(blocker)
    const message = ruText(START_BLOCKER_LABELS[blocker])
    renderWithLocale(
      <MissionForm view={view} onStart={() => undefined} onStop={() => undefined} />,
    )
    const start = screen.getByRole("button", { name: RU.mission.action.start })
    expect(start.getAttribute("aria-disabled")).toBe("true")
    fireEvent.focus(start)
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
  })

  it.each(STOP_BLOCKERS)("explains the %s Stop blocker", async (blocker) => {
    const view = STOP_VIEWS[blocker]
    expect(stopDisabledReason(view)).toBe(blocker)
    const message = ruText(STOP_BLOCKER_LABELS[blocker])
    renderWithLocale(
      <MissionForm view={view} compact onStart={() => undefined} onStop={() => undefined} />,
    )
    const stop = screen.getByRole("button", { name: RU.mission.action.stop })
    expect(stop.getAttribute("aria-disabled")).toBe("true")
    fireEvent.focus(stop)
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
  })

  it("rejects a fractional seed and an unsupported option", () => {
    const view = viewOf({
      snapshot: idle,
      health: { ...READY_HEALTH, supported_map_modes: ["static"] },
    })
    renderWithLocale(
      <MissionForm view={view} onStart={() => undefined} onStop={() => undefined} />,
    )
    const seed = screen.getByRole("textbox", { name: RU.mission.form.seed })
    fireEvent.change(seed, { target: { value: "1.5" } })
    fireEvent.blur(seed)
    expect(screen.getAllByText(RU.mission.form.seedInvalid).length).toBeGreaterThan(0)
  })

  it("does not repeat the busy hint under a visible command banner", () => {
    renderWithLocale(
      <MissionForm
        view={START_VIEWS.command_busy}
        onStart={() => undefined}
        onStop={() => undefined}
      />,
    )
    expect(screen.queryByText(RU.mission.blocker.start.commandBusy)).toBeNull()
  })
})

describe("CommandBanner phases", () => {
  it.each(["sending", "awaiting", "unknown", "failed"] as const)(
    "titles the %s phase",
    (phase) => {
      const { controller } = controllerSpy()
      renderWithLocale(
        <CommandBanner
          command={{ ...IDLE_COMMAND, phase, kind: "stop" }}
          controller={controller}
        />,
      )
      expect(screen.getByText(RU.mission.command[phase])).toBeTruthy()
    },
  )

  it("lets the user dismiss a failed command", () => {
    const { controller, calls } = controllerSpy()
    renderWithLocale(
      <CommandBanner
        command={{ ...IDLE_COMMAND, phase: "failed", kind: "start" }}
        controller={controller}
      />,
    )
    const buttons = screen.getAllByRole("button")
    const close = buttons[buttons.length - 1]
    if (close === undefined) throw new Error("close button expected")
    fireEvent.click(close)
    expect(calls).toEqual(["dismissCommandMessage()"])
  })
})

function statOf(label: string): HTMLElement {
  const stat = screen.getByText(label).closest("[data-tone]")
  if (!(stat instanceof HTMLElement)) throw new Error(`no stat ${label}`)
  return stat
}

describe("MissionStats missing values", () => {
  it("shows a dash for a lost sample signal and says the battery is unknown", () => {
    const dropout = findFrame(
      "hard_events",
      (item) => item.sample_signal === null && item.robot_pose !== null,
    )
    renderWithLocale(<MissionStats snapshot={{ ...dropout, battery_remaining: null }} />)
    expect(statOf(RU.mission.metric.signal).querySelector("[data-no-value]")).not.toBeNull()
    const unknown = RU.mission.value.batteryUnknown.replace(
      "{{initial}}",
      String(dropout.battery_initial),
    )
    expect(screen.getByText(unknown)).toBeTruthy()
  })

  it("names the current goal", () => {
    const approach = findFrame("success", (item) => item.current_goal?.kind === "approach")
    renderWithLocale(<MissionStats snapshot={approach} />)
    expect(screen.getByText(RU.mission.goal.approach)).toBeTruthy()
  })
})

describe("RunSummary outcomes", () => {
  it.each([
    ["success", "completed", "success"],
    ["stopped", "stopped", "interrupted"],
    ["failed", "failed", "failure"],
  ] as const)("shows the %s outcome with its own icon", (_name, status, outcome) => {
    const { container } = renderWithLocale(
      <RunSummary snapshot={{ ...frame("success", -1), status, team: null }} />,
    )
    const labels = {
      success: RU.mission.outcome.success,
      interrupted: RU.mission.outcome.interrupted,
      failure: RU.mission.outcome.failure,
    }
    expect(screen.getByText(labels[outcome])).toBeTruthy()
    expect(container.querySelector(`[data-outcome='${outcome}']`)).not.toBeNull()
  })

  it("reports the team result instead of one robot", () => {
    const partial = frame("team_partial", -1)
    const { container } = renderWithLocale(<RunSummary snapshot={partial} />)
    expect(screen.getByText(RU.mission.teamOutcome.partial)).toBeTruthy()
    expect(screen.queryByText(RU.mission.outcome.success)).toBeNull()
    expect(container.querySelector("[data-team='true']")).not.toBeNull()
  })

  it("tells a retryable error from a final one", () => {
    const failed = { ...frame("failed", -1), team: null }
    const error = failed.last_error ?? { code: "x", message: "m", retryable: true }
    const { rerender } = renderWithLocale(
      <RunSummary snapshot={{ ...failed, last_error: { ...error, retryable: true } }} />,
    )
    expect(screen.getByText(RU.mission.summary.retryable)).toBeTruthy()
    rerender(
      <RunSummary snapshot={{ ...failed, last_error: { ...error, retryable: false } }} />,
    )
    expect(screen.getByText(RU.mission.summary.final)).toBeTruthy()
  })
})
