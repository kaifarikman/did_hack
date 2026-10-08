import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildScene } from "@/ui/features/map/scene"
import { MissionForm } from "@/ui/features/mission/mission-form"
import { NavigationRun } from "@/ui/features/mission/navigation-run"
import { exampleMap, idle, running } from "../../support"
import { renderWithLocale } from "./render"
import { RU, viewOf } from "./views"

const target = { position_x_m: -0.5, position_y_m: 0.25, map_id: exampleMap().map_id }
const navigation = {
  target,
  phase: "returning" as const,
  target_reached: true,
  target_reached_at_s: 10,
  arrival_tolerance_m: 0.12,
}
describe("navigation in redesigned mission UI", () => {
  it("sends easy static one robot target only on explicit Start", () => {
    const onStart = vi.fn()
    renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: idle() })}
        onStart={onStart}
        onStop={vi.fn()}
        taskType="navigation"
        navigationTarget={target}
      />,
    )
    expect(onStart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: RU.mission.action.start }))
    expect(onStart).toHaveBeenCalledWith({
      seed: 42,
      scenario: "easy",
      missionText: "",
      mapMode: "static",
      robotCount: 1,
      navigationTarget: target,
    })
  })
  it("does not submit a blocked or missing target", () => {
    const onStart = vi.fn()
    const { container } = renderWithLocale(
      <MissionForm
        view={viewOf({ snapshot: idle() })}
        onStart={onStart}
        onStop={vi.fn()}
        taskType="navigation"
        navigationBlocked
      />,
    )
    const form = container.querySelector("form")
    if (form === null) throw new Error("Missing form")
    fireEvent.submit(form)
    expect(onStart).not.toHaveBeenCalled()
  })
  it("shows arrival as progress, preserves user target and accepts a one-point path", () => {
    const snapshot = {
      ...running(),
      task_type: "navigation" as const,
      navigation,
      planned_path: [target],
    }
    renderWithLocale(<NavigationRun snapshot={snapshot} />)
    expect(screen.getByText(RU.mission.navigation.outcome.returning)).toBeTruthy()
    expect(screen.queryByText(RU.mission.navigation.outcome.success)).toBeNull()
    expect(screen.getByText(RU.mission.navigation.path)).toBeTruthy()
    const scene = buildScene(snapshot, target)
    expect(scene.userTarget).toEqual(target)
    expect(scene.goal).toEqual(snapshot.current_goal?.target)
    expect(scene.draftTarget).toEqual(target)
  })
})
