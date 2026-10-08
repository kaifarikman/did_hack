import { describe, expect, it } from "vitest"
import { describeError } from "../src/application/errorDescription"
import { ApiError } from "../src/application/errors"
import { navigationStartDisabledReason } from "../src/application/navigation"
import type { MissionSnapshot, NavigationPhase, NavigationView } from "../src/domain/contract"
import {
  isGoalLocked,
  navigationOutcome,
  navigationStages,
} from "../src/domain/navigationPresentation"
import { parseHealth, parseSnapshot } from "../src/domain/validation"
import { readyHealth, running } from "./support"

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

describe("D1 state contract", () => {
  it("state 1.4 carries task and target", () => {
    const snapshot = parseSnapshot(navigationState("moving_to_target"))
    expect(snapshot.task_type).toBe("navigation")
    expect(snapshot.navigation).toMatchObject({
      phase: "moving_to_target",
      target_reached: false,
      arrival_tolerance_m: 0.12,
    })
    expect(snapshot.navigation?.target.map_id).toBe("fixture-map-v1")
  })

  it("legacy state defaults to research", () => {
    const snapshot = parseSnapshot(structuredClone(running()))
    expect(snapshot.schema_version).toBe("1.3")
    expect(snapshot.task_type).toBe("research")
    expect(snapshot.navigation).toBeNull()
    const legacy = structuredClone(running()) as unknown as Record<string, unknown>
    legacy.schema_version = "1.0"
    expect(parseSnapshot(legacy).task_type).toBe("research")
  })

  it("required fields and valid phase", () => {
    const missing = structuredClone(navigationState("moving_to_target")) as Record<
      string,
      unknown
    >
    delete missing.task_type
    expect(() => parseSnapshot(missing)).toThrow(/task_type/)
    expect(() =>
      parseSnapshot({ ...(navigationState("moving_to_target") as object), navigation: null }),
    ).toThrow(/navigation/i)
    expect(() => parseSnapshot(navigationState("flying" as NavigationPhase))).toThrow(/phase/)
    expect(() => parseSnapshot(navigationState("pending", { arrival_tolerance_m: 0 }))).toThrow(
      /arrival_tolerance_m/,
    )
  })

  it("research has null navigation", () => {
    const research = {
      ...(structuredClone(running()) as object),
      schema_version: "1.4",
      task_type: "research",
      navigation: null,
    }
    expect(parseSnapshot(research).navigation).toBeNull()
  })

  it("health defaults to research without capability", () => {
    const { supported_task_types: _ignored, ...legacy } = readyHealth
    expect(parseHealth(legacy).supported_task_types).toEqual(["research"])
    expect(
      parseHealth({ ...legacy, supported_task_types: ["research", "navigation"] })
        .supported_task_types,
    ).toContain("navigation")
    const view = { health: parseHealth(legacy) } as Parameters<
      typeof navigationStartDisabledReason
    >[0]
    expect(navigationStartDisabledReason(view)).toBe("unsupported")
  })
})

describe("arrival is not mission completion", () => {
  const stateOf = (
    phase: NavigationPhase,
    status: MissionSnapshot["status"],
    patch: Partial<NavigationView> = {},
    error: MissionSnapshot["last_error"] = null,
  ) =>
    ({
      ...parseSnapshot(navigationState(phase, patch, status)),
      last_error: error,
    }) as MissionSnapshot

  it("arrival during return is progress", () => {
    const snapshot = stateOf("returning", "returning", {
      target_reached: true,
      target_reached_at_s: 12.5,
    })
    expect(navigationOutcome(snapshot)).toBe("returning")
    const stages = navigationStages(snapshot)
    expect(stages.find((stage) => stage.id === "reached")?.state).toBe("done")
    expect(stages.find((stage) => stage.id === "return")?.state).toBe("current")
    expect(stages.find((stage) => stage.id === "finish")?.state).toBe("todo")
  })

  it("success requires arrival and finish", () => {
    expect(
      navigationOutcome(
        stateOf("finished", "completed", { target_reached: true, target_reached_at_s: 9 }),
      ),
    ).toBe("success")
    expect(navigationOutcome(stateOf("finished", "completed"))).toBe("unconfirmed")
    expect(navigationOutcome(stateOf("moving_to_target", "running"))).toBeNull()
  })

  it("unreached goal fails after safe return", () => {
    const error = { code: "navigation_goal_not_reached", message: "x", retryable: false }
    const outcome = navigationOutcome(stateOf("failed", "failed", {}, error))
    expect(outcome).toBe("not_reached")
  })

  it("stop interrupts even after arrival", () => {
    expect(navigationOutcome(stateOf("stopped", "stopped"))).toBe("stopped")
    expect(navigationOutcome(stateOf("stopped", "stopped", { target_reached: true }))).toBe(
      "stopped",
    )
  })

  it("active runs lock the target", () => {
    expect(isGoalLocked(null)).toBe(false)
    expect(isGoalLocked(stateOf("pending", "starting"))).toBe(true)
    expect(isGoalLocked(stateOf("moving_to_target", "stopping"))).toBe(true)
    expect(isGoalLocked(stateOf("finished", "completed"))).toBe(false)
  })
})

describe("localized D1 API errors", () => {
  const cases: Array<[number, string]> = [
    [422, "navigation_target_unreachable"],
    [409, "map_changed"],
    [409, "run_conflict"],
    [409, "scenario_unavailable"],
    [503, "environment_not_ready"],
    [422, "invalid_request"],
  ]
  it.each(cases)("%i %s", (status, code) => {
    const message = describeError(new ApiError(status, code, "Backend detail", false))
    expect(message.key).toBe(`errors:api.${code}`)
  })
})
