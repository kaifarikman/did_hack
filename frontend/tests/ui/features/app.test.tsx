import { screen } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"
import { READY_HEALTH } from "@/adapters/fixture/baseline"
import { buildScript } from "@/adapters/fixture/catalog"
import { AppNotices } from "@/ui/app/app-notices"
import { IdleSplash, splashCopy } from "@/ui/app/idle-splash"
import { MapCard } from "@/ui/features/map/map-card"
import { renderWithLocale } from "./render"
import { frame, RU, viewOf } from "./views"

describe("app notices", () => {
  it("shows the stale banner when data is old but present", () => {
    renderWithLocale(
      <AppNotices view={viewOf({ connection: "stale", snapshot: frame("success", 5) })} />,
    )
    expect(screen.getByText(RU.common.connection.stale)).toBeTruthy()
  })

  it("stays empty while the connection is live", () => {
    const { container } = renderWithLocale(
      <AppNotices view={viewOf({ snapshot: frame("success", 5) })} />,
    )
    expect(container.textContent).toBe("")
  })
})

describe("idle splash", () => {
  const idle = buildScript("idle_ready").idle

  it("covers the first load without a fade-in and says it is connecting", () => {
    const { container } = renderWithLocale(
      <IdleSplash view={viewOf({ connection: "connecting", health: null })} />,
    )
    expect(screen.getByText(RU.mission.splash.connectingTitle)).toBeTruthy()
    expect(container.querySelector("[data-initial='true'][data-state='open']")).not.toBeNull()
  })

  it("shows the offline hero without any data", () => {
    renderWithLocale(<IdleSplash view={viewOf({ connection: "stale", snapshot: null })} />)
    expect(screen.getByText(RU.mission.splash.offlineTitle)).toBeTruthy()
  })

  it("shows the ready splash before the first run and hides it during a run", () => {
    expect(splashCopy(viewOf({ snapshot: idle }))?.kind).toBe("ready")
    expect(splashCopy(viewOf({ snapshot: frame("success", 3) }))).toBeNull()
    renderWithLocale(<IdleSplash view={viewOf({ snapshot: idle })} />)
    expect(screen.getByText(RU.mission.splash.title)).toBeTruthy()
  })

  it("tells the environment is still starting instead of ready", () => {
    renderWithLocale(
      <IdleSplash
        view={viewOf({
          snapshot: idle,
          health: { ...READY_HEALTH, status: "starting", ros_connected: false },
        })}
      />,
    )
    expect(screen.getByText(RU.mission.splash.startingTitle)).toBeTruthy()
    expect(screen.getByText(RU.mission.splash.startingRos)).toBeTruthy()
    expect(screen.queryByText(RU.mission.splash.title)).toBeNull()
  })

  it("names each environment stage", () => {
    const copyOf = (health: typeof READY_HEALTH | null) =>
      splashCopy(viewOf({ snapshot: idle, health }))
    expect(copyOf(null)?.title.key).toBe("mission:splash.startingTitle")
    expect(copyOf({ ...READY_HEALTH, status: "starting" })?.description.key).toBe(
      "mission:splash.startingEnv",
    )
    expect(copyOf({ ...READY_HEALTH, llm_available: false })?.description.key).toBe(
      "mission:splash.readyFallback",
    )
  })

  it("reports a rejected start instead of claiming readiness", () => {
    const rejected = viewOf({
      snapshot: idle,
      command: {
        phase: "failed",
        kind: "start",
        message: { key: "mission:blocker.start.environmentStarting" },
        cause: null,
        canRetry: false,
      },
    })
    renderWithLocale(<IdleSplash view={rejected} />)
    expect(screen.getByText(RU.mission.splash.rejectedTitle)).toBeTruthy()
    expect(screen.getByText(RU.mission.blocker.start.environmentStarting)).toBeTruthy()
    expect(screen.queryByText(RU.mission.splash.title)).toBeNull()
  })
})

class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("map card states", () => {
  beforeAll(() => {
    Object.assign(globalThis, { ResizeObserver: StillResizeObserver })
  })

  it("says the map is missing, then that versions differ", () => {
    const slam = frame("slam_building", 1)
    const { rerender } = renderWithLocale(
      <MapCard
        map={null}
        snapshot={slam}
        mapError={{ key: "errors:kind.unknown" }}
        stale={false}
        motionIndex={0}
      />,
    )
    expect(screen.getByText(RU.map.state.missing)).toBeTruthy()
    const other = buildScript("success").maps[0]?.map ?? null
    rerender(
      <MapCard map={other} snapshot={slam} mapError={null} stale={false} motionIndex={0} />,
    )
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(RU.map.describe.unavailable)
    const mismatch = RU.map.state.mismatch
      .replace("{{expected}}", slam.map_id ?? "")
      .replace("{{loaded}}", other?.map_id ?? "")
    expect(screen.getByText(mismatch)).toBeTruthy()
  })

  it("fades the waiting overlay out once the map can be drawn", () => {
    const success = frame("success", 3)
    const map = buildScript("success").maps[0]?.map ?? null
    const { container, rerender } = renderWithLocale(
      <MapCard map={null} snapshot={success} mapError={null} stale={false} motionIndex={0} />,
    )
    expect(container.querySelector("[data-state='open']")).not.toBeNull()
    rerender(
      <MapCard
        map={map}
        snapshot={{ ...success, map_id: map?.map_id ?? null }}
        mapError={null}
        stale={false}
        motionIndex={0}
      />,
    )
    const closing = container.querySelector("[data-state='closed'][data-motion='fade']")
    expect(closing?.textContent).not.toBe("")
  })
})
