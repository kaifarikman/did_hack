import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { READY_HEALTH } from "@/adapters/fixture/baseline"
import { IDLE_COMMAND, showStopAction } from "@/application/viewState"
import { MissionForm } from "@/ui/features/mission/mission-form"
import { NavigationFields } from "@/ui/features/mission/navigation-fields"
import { idle, running } from "../../support"
import { renderWithLocale } from "./render"
import { RU, viewOf } from "./views"

describe("mission capability visibility", () => {
  it("allows returning to research after navigation support disappears", () => {
    const onTaskType = vi.fn()
    renderWithLocale(
      <NavigationFields
        taskType="navigation"
        onTaskType={onTaskType}
        draft={{ xText: "", yText: "", mapId: null }}
        evaluation={{ point: null, target: null, problem: "empty", warning: null }}
        locked={false}
        supported={false}
        onUpdate={vi.fn()}
        onConfirm={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.queryByRole("radio", { name: RU.mission.navigation.navigation })).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: RU.mission.navigation.research }))
    expect(onTaskType).toHaveBeenCalledWith("research")
  })

  it("normalizes removed choices without losing seed or mission text", () => {
    const onStart = vi.fn()
    const initial = viewOf({ snapshot: idle() })
    const { rerender } = renderWithLocale(
      <MissionForm view={initial} onStart={onStart} onStop={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole("radio", { name: RU.mission.mapMode.slam }))
    fireEvent.click(screen.getByRole("radio", { name: "2" }))
    fireEvent.click(screen.getByRole("radio", { name: RU.mission.scenario.hard }))
    fireEvent.change(screen.getByRole("textbox", { name: RU.mission.form.seed }), {
      target: { value: "37" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: RU.mission.form.missionText }), {
      target: { value: "Search the northern area" },
    })
    rerender(
      <MissionForm
        view={viewOf({
          snapshot: idle(),
          health: {
            ...READY_HEALTH,
            supported_scenarios: ["easy"],
            supported_map_modes: ["static"],
            supported_robot_counts: [1],
          },
        })}
        onStart={onStart}
        onStop={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
    expect(screen.getByText(RU.mission.mapMode.static)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: RU.mission.action.start }))
    expect(onStart).toHaveBeenCalledWith({
      seed: 37,
      scenario: "easy",
      mapMode: "static",
      robotCount: 1,
      missionText: "Search the northern area",
    })
  })

  it.each(["sending", "awaiting", "unknown"] as const)(
    "keeps Stop visible during %s reconciliation even without a run",
    (phase) => {
      const view = viewOf({
        snapshot: idle(),
        command: { ...IDLE_COMMAND, kind: "stop", phase },
      })
      renderWithLocale(<MissionForm view={view} onStart={vi.fn()} onStop={vi.fn()} />)
      expect(showStopAction(view)).toBe(true)
      expect(screen.getByRole("button", { name: RU.mission.action.stop })).toBeTruthy()
    },
  )

  it("retains both protected actions during a stale active run", () => {
    renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: running(), connection: "stale" })}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    )
    for (const label of [RU.mission.action.start, RU.mission.action.stop])
      expect(screen.getByRole("button", { name: label }).getAttribute("aria-disabled")).toBe(
        "true",
      )
  })
})
