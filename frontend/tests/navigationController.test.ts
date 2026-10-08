import { describe, expect, it } from "vitest"
import { ApiError, NetworkError } from "../src/application/errors"
import { MissionController } from "../src/application/missionController"
import type { MissionSnapshot, NavigationPhase, NavigationView } from "../src/domain/contract"
import { parseSnapshot } from "../src/domain/validation"
import {
  ControlledGateway,
  exampleMap,
  FakeScheduler,
  flush,
  idle,
  readyHealth,
  running,
} from "./support"

function navigationState(
  phase: NavigationPhase,
  patch: Partial<NavigationView> = {},
  status: MissionSnapshot["status"] = "running",
): unknown {
  const base = structuredClone(running()) as unknown as Record<string, unknown>
  return {
    ...base,
    schema_version: "1.4",
    status,
    task_type: "navigation",
    navigation: {
      target: { position_x_m: -0.75, position_y_m: 0.5, map_id: "fixture-map-v1" },
      phase,
      target_reached: false,
      target_reached_at_s: null,
      arrival_tolerance_m: 0.12,
      ...patch,
    },
  }
}

async function boot(snapshot: MissionSnapshot = idle(), health = readyHealth) {
  const gateway = new ControlledGateway()
  const scheduler = new FakeScheduler()
  let counter = 0
  const controller = new MissionController({
    gateway,
    scheduler,
    generateId: () => {
      counter += 1
      return `req-${counter}`
    },
  })
  controller.start()
  gateway.healthCalls[0]?.deferred.resolve(health)
  gateway.mapCalls[0]?.deferred.resolve(exampleMap())
  await flush()
  gateway.stateCalls[0]?.deferred.resolve(snapshot)
  await flush()
  return { gateway, scheduler, controller }
}

const TARGET = { position_x_m: -0.75, position_y_m: 0.5, map_id: "fixture-map-v1" }

describe("navigation controller", () => {
  it("sends exact target and profile without mission prose", async () => {
    const { gateway, controller } = await boot()
    void controller.startRun(7, "easy", "Move somewhere", "static", 1, TARGET)
    await flush()
    expect(gateway.startCalls).toHaveLength(1)
    expect(gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "easy",
      seed: 7,
      task_type: "navigation",
      navigation_target: TARGET,
    })
  })

  it("research request remains unchanged", async () => {
    const { gateway, controller } = await boot()
    void controller.startRun(7, "easy", "", "static", 1)
    await flush()
    expect(gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "easy",
      seed: 7,
    })
  })

  it("rejects unsupported capability map and profile", async () => {
    const legacyHealth = { ...readyHealth, supported_task_types: ["research" as const] }
    const unsupported = await boot(idle(), legacyHealth)
    await unsupported.controller.startRun(7, "easy", "", "static", 1, TARGET)
    expect(unsupported.gateway.startCalls).toHaveLength(0)

    const { gateway, controller } = await boot()
    await controller.startRun(7, "easy", "", "static", 1, { ...TARGET, map_id: "other-map" })
    await controller.startRun(7, "medium", "", "static", 1, TARGET)
    await controller.startRun(7, "easy", "", "slam", 1, TARGET)
    await controller.startRun(7, "easy", "", "static", 2, TARGET)
    expect(gateway.startCalls).toHaveLength(0)
  })

  it("unknown outcome retries same request after reconciliation", async () => {
    const { gateway, scheduler, controller } = await boot()
    void controller.startRun(7, "easy", "", "static", 1, TARGET)
    await flush()
    gateway.startCalls[0]?.deferred.reject(new NetworkError())
    await flush()
    expect(controller.getView().command).toMatchObject({ phase: "unknown", canRetry: false })
    await scheduler.advance(500)
    gateway.stateCalls.at(-1)?.deferred.resolve(idle())
    await flush()
    expect(controller.getView().command.canRetry).toBe(true)
    void controller.retryCommand()
    await flush()
    expect(gateway.startCalls).toHaveLength(2)
    expect(gateway.startCalls[1]?.request).toEqual(gateway.startCalls[0]?.request)
  })

  it("map rejection reloads map before new request", async () => {
    const { gateway, controller } = await boot()
    const mapCallsBefore = gateway.mapCalls.length
    void controller.startRun(7, "easy", "", "static", 1, TARGET)
    await flush()
    gateway.startCalls[0]?.deferred.reject(new ApiError(409, "map_changed", "old", false))
    await flush()
    const command = controller.getView().command
    expect(command.phase).toBe("failed")
    expect(command.message?.key).toBe("errors:api.map_changed")
    expect(gateway.mapCalls.length).toBe(mapCallsBefore + 1)
    gateway.mapCalls.at(-1)?.deferred.resolve({ ...exampleMap(), map_id: "fixture-map-v2" })
    await flush()
    expect(controller.getView().map?.map_id).toBe("fixture-map-v2")
    controller.dismissCommandMessage()
    void controller.startRun(7, "easy", "", "static", 1, {
      ...TARGET,
      map_id: "fixture-map-v2",
    })
    await flush()
    expect(gateway.startCalls[1]?.request.request_id).toBe("req-2")
  })

  it("stop targets the active run", async () => {
    const active = {
      ...parseSnapshot(navigationState("moving_to_target")),
      run_id: "run-nav",
      revision: 3,
    } as MissionSnapshot
    const { gateway, controller } = await boot(active)
    void controller.stopRun()
    await flush()
    expect(gateway.stopCalls[0]?.runId).toBe("run-nav")
  })
})
