import { act, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { browserScheduler } from "@/adapters/browserScheduler"
import { FixtureMissionGateway } from "@/adapters/fixture/fixtureGateway"
import { MissionController } from "@/application/missionController"
import { AppShell } from "@/ui/app"
import { readViewMode } from "@/ui/app/viewMode"
import ruDemo from "@/ui/shared/i18n/locales/ru/demo.json"
import { renderWithLocale } from "./render"

class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const controllers: MissionController[] = []

function controllerOver(gateway: FixtureMissionGateway): MissionController {
  const controller = new MissionController({
    gateway,
    scheduler: browserScheduler,
    generateId: () => "request-1",
  })
  controllers.push(controller)
  return controller
}

describe("show mode", () => {
  beforeAll(() => {
    Object.assign(globalThis, { ResizeObserver: StillResizeObserver })
  })

  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose()
    window.history.replaceState(null, "", "/")
  })

  it("is chosen only by the view=show address parameter", () => {
    expect(readViewMode("?view=show")).toBe("show")
    expect(readViewMode("?view=other")).toBe("default")
    expect(readViewMode("")).toBe("default")
  })

  it("marks the layout for the projector", async () => {
    window.history.replaceState(null, "", "/?view=show")
    const gateway = new FixtureMissionGateway()
    const { container } = renderWithLocale(
      <AppShell controller={controllerOver(gateway)} fixtureControls={gateway} />,
    )
    await act(async () => undefined)
    expect(container.querySelector("[data-view='show']")).not.toBeNull()
  })

  it("has no demo controls on live data", async () => {
    renderWithLocale(
      <AppShell
        controller={controllerOver(new FixtureMissionGateway())}
        fixtureControls={null}
      />,
    )
    await act(async () => undefined)
    expect(screen.queryByRole("combobox", { name: ruDemo.picker })).toBeNull()
    expect(screen.queryByText(ruDemo.badge)).toBeNull()
  })

  it("shows the demo controls on demo data", async () => {
    const gateway = new FixtureMissionGateway()
    renderWithLocale(
      <AppShell controller={controllerOver(gateway)} fixtureControls={gateway} />,
    )
    await act(async () => undefined)
    expect(screen.getByRole("combobox", { name: ruDemo.picker })).toBeTruthy()
    expect(screen.getByText(ruDemo.badge)).toBeTruthy()
  })
})
