import { describe, expect, it } from "vitest"
import type { FixtureScenarioName } from "../src/adapters/fixture/catalog"
import { FixtureMissionGateway } from "../src/adapters/fixture/fixtureGateway"
import { NAVIGATION_OUTAGE_FRAME_INDEX } from "../src/adapters/fixture/navigationScript"
import { NetworkError } from "../src/application/errors"
import type { MissionSnapshot, StartRunRequest } from "../src/domain/contract"
import { isFinishedStatus } from "../src/domain/status"

const MAP_ID = "fixture-map-v1"
const GOOD_TARGET = { position_x_m: -0.5, position_y_m: 0.25, map_id: MAP_ID }
function navigationRequest(
  patch: Partial<StartRunRequest> = {},
  requestId = "n1",
): StartRunRequest {
  return {
    request_id: requestId,
    scenario: "easy",
    seed: 7,
    task_type: "navigation",
    navigation_target: GOOD_TARGET,
    ...patch,
  }
}
async function started(name: FixtureScenarioName, request = navigationRequest()) {
  const gateway = new FixtureMissionGateway()
  gateway.setScenario(name)
  const first = await gateway.startRun(request)
  return { gateway, first }
}
async function play(gateway: FixtureMissionGateway, limit = 200): Promise<MissionSnapshot[]> {
  const frames: MissionSnapshot[] = []
  for (let step = 0; step < limit; step += 1) {
    try {
      const frame = await gateway.getState()
      frames.push(frame)
      if (isFinishedStatus(frame.status)) break
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError)
    }
  }
  return frames
}
describe("navigation fixture success", () => {
  it("pending moving arrival returning and finish", async () => {
    const { gateway, first } = await started("nav_success")
    expect(first).toMatchObject({
      schema_version: "1.4",
      task_type: "navigation",
      status: "starting",
    })
    expect(first.navigation).toMatchObject({
      phase: "pending",
      target_reached: false,
      target: GOOD_TARGET,
    })
    const frames = await play(gateway)
    const phases = frames.map((frame) => frame.navigation?.phase)
    expect(phases).toContain("moving_to_target")
    const firstReached = frames.findIndex((frame) => frame.navigation?.target_reached === true)
    const completedAt = frames.findIndex((frame) => frame.status === "completed")
    expect(firstReached).toBeGreaterThan(0)
    expect(completedAt).toBeGreaterThan(firstReached)
    const returning = frames.slice(firstReached, completedAt)
    expect(
      returning.every(
        (frame) => frame.status === "returning" && frame.navigation?.phase === "returning",
      ),
    ).toBe(true)
    expect(returning.every((frame) => frame.navigation?.target_reached === true)).toBe(true)
    const last = frames[frames.length - 1] as MissionSnapshot
    expect(last.navigation).toMatchObject({ phase: "finished", target_reached: true })
    expect(last.status).toBe("completed")
    expect(last.last_error).toBeNull()
  })
  it("user target stays fixed independently of subgoals", async () => {
    const { gateway } = await started("nav_success")
    const frames = await play(gateway)
    expect(frames.every((frame) => frame.navigation?.target.map_id === MAP_ID)).toBe(true)
    expect(new Set(frames.map((frame) => JSON.stringify(frame.navigation?.target))).size).toBe(
      1,
    )
    const subgoals = new Set(frames.map((frame) => frame.current_goal?.kind).filter(Boolean))
    expect(subgoals).toContain("approach")
    expect(subgoals).toContain("return")
  })
  it("journal contains navigation events", async () => {
    const { gateway, first } = await started("nav_success")
    await play(gateway)
    const page = await gateway.getJournalPage(first.run_id as string, 0, 200)
    const titles = page.entries.map((item) => item.title)
    expect(titles).toEqual(
      expect.arrayContaining([
        "navigation_target_set",
        "navigation_target_reached",
        "navigation_return_started",
      ]),
    )
  })
  it("research remains research in navigation scenario", async () => {
    const { gateway, first } = await started("nav_success", {
      request_id: "r",
      scenario: "easy",
      seed: 1,
    })
    expect(first.task_type).toBe("research")
    expect(first.navigation).toBeNull()
    expect((await play(gateway)).at(-1)?.status).toBe("completed")
  })
})
describe("navigation rejection cases", () => {
  it("occupied or outside target returns 422", async () => {
    for (const target of [
      { position_x_m: -2.4, position_y_m: 0, map_id: MAP_ID },
      { position_x_m: 9, position_y_m: 9, map_id: MAP_ID },
    ]) {
      const gateway = new FixtureMissionGateway()
      gateway.setScenario("nav_success")
      await expect(
        gateway.startRun(navigationRequest({ navigation_target: target })),
      ).rejects.toMatchObject({
        status: 422,
        code: "navigation_target_unreachable",
        retryable: false,
      })
    }
  })
  it("invalid request combinations return 422", async () => {
    const gateway = new FixtureMissionGateway()
    await expect(
      gateway.startRun({
        request_id: "missing-target",
        scenario: "easy",
        seed: 7,
        task_type: "navigation",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_request" })
    await expect(
      gateway.startRun({
        request_id: "r",
        scenario: "easy",
        seed: 1,
        navigation_target: GOOD_TARGET,
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_request" })
  })
  it("map changes and explicit retry uses new map", async () => {
    const gateway = new FixtureMissionGateway()
    gateway.setScenario("nav_map_changed")
    await expect(gateway.startRun(navigationRequest())).rejects.toMatchObject({
      status: 409,
      code: "map_changed",
      retryable: false,
    })
    const map = await gateway.getMap()
    expect(map.map_id).not.toBe(MAP_ID)
    expect((await gateway.getState()).map_id).toBe(map.map_id)
    const retried = await gateway.startRun(
      navigationRequest({ navigation_target: { ...GOOD_TARGET, map_id: map.map_id } }, "n2"),
    )
    expect(retried.navigation?.target.map_id).toBe(map.map_id)
  })
  it("unsupported navigation returns 409", async () => {
    const refusing = new FixtureMissionGateway()
    refusing.setScenario("nav_refused")
    await expect(refusing.startRun(navigationRequest())).rejects.toMatchObject({
      status: 409,
      code: "scenario_unavailable",
    })
    const gateway = new FixtureMissionGateway()
    await expect(
      gateway.startRun(navigationRequest({ scenario: "hard" })),
    ).rejects.toMatchObject({ code: "scenario_unavailable" })
    await expect(gateway.startRun(navigationRequest({ robot_count: 2 }))).rejects.toMatchObject(
      { code: "scenario_unavailable" },
    )
  })
  it("idempotency preserves payload and rejects changed request", async () => {
    const { gateway, first } = await started("nav_success")
    const repeated = await gateway.startRun(navigationRequest())
    expect(repeated.run_id).toBe(first.run_id)
    await expect(
      gateway.startRun(
        navigationRequest({ navigation_target: { ...GOOD_TARGET, position_x_m: -0.25 } }),
      ),
    ).rejects.toMatchObject({ status: 409, code: "run_conflict" })
  })
  it("active run rejects second start", async () => {
    const { gateway } = await started("nav_success")
    await gateway.getState()
    await expect(gateway.startRun(navigationRequest({}, "n2"))).rejects.toMatchObject({
      status: 409,
      code: "run_conflict",
    })
  })
})
describe("navigation failure stop and stale", () => {
  it("unreached goal returns and fails", async () => {
    const { gateway } = await started("nav_not_reached")
    const frames = await play(gateway)
    expect(frames.some((frame) => frame.navigation?.target_reached === true)).toBe(false)
    expect(frames.some((frame) => frame.navigation?.phase === "returning")).toBe(true)
    const last = frames[frames.length - 1] as MissionSnapshot
    expect(last).toMatchObject({
      status: "failed",
      navigation: { phase: "failed", target_reached: false },
    })
    expect(last.last_error?.code).toBe("navigation_goal_not_reached")
  })
  it("stop passes through stopping then stopped", async () => {
    const { gateway, first } = await started("nav_success")
    for (let index = 0; index < 3; index += 1) await gateway.getState()
    await gateway.stopRun(first.run_id as string, { request_id: "s1" })
    const stopping = await gateway.getState()
    const stopped = await gateway.getState()
    expect([stopping.status, stopped.status]).toEqual(["stopping", "stopped"])
    expect(stopped.navigation?.phase).toBe("stopped")
    expect(stopped.navigation?.target_reached).toBe(false)
  })
  it("connection outage pauses delivery then recovers", async () => {
    const { gateway } = await started("nav_disconnect")
    for (let index = 0; index < NAVIGATION_OUTAGE_FRAME_INDEX - 1; index += 1)
      await gateway.getState()
    let failures = 0
    for (let index = 0; index < 20 && failures < 20; index += 1) {
      try {
        await gateway.getState()
        break
      } catch {
        failures += 1
      }
    }
    expect(failures).toBeGreaterThan(6)
    expect((await play(gateway)).at(-1)?.status).toBe("completed")
  })
})
