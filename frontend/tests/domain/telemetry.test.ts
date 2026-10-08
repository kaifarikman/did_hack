import { describe, expect, it } from "vitest"
import { parseSnapshot } from "@/domain/validation"
import { running } from "../support"

describe("telemetry survives frontend redesign", () => {
  it("retains generation, source freshness and independent revisions", () => {
    const source = {
      ...running(),
      schema_version: "1.3",
      robot_id: "robot_2",
      generation: 7,
      observation_sequence: 42,
      sample_signal_age_s: 0.4,
      route_revision: 4,
      plan_revision: 2,
      map_revision: 6,
      model_revision: 3,
      freshness: {
        odom: { age_s: 0.1, fresh: true },
        scan: { age_s: 4, fresh: false },
        battery: { age_s: null, fresh: null },
        clock: { age_s: 0, fresh: true },
      },
    }
    expect(parseSnapshot(source)).toMatchObject(source)
  })
  it("legacy snapshots have unknown freshness and zero revisions", () => {
    const legacy = { ...running(), schema_version: "1.0" }
    const snapshot = parseSnapshot(legacy)
    expect(snapshot.route_revision).toBe(0)
    expect(snapshot.map_revision).toBe(0)
    expect(snapshot.freshness.scan).toEqual({ age_s: null, fresh: null })
  })
  it("rejects missing source freshness in schema 1.3", () => {
    const source: Record<string, unknown> = { ...running(), schema_version: "1.3" }
    delete source.freshness
    expect(() => parseSnapshot(source)).toThrow(/freshness/)
  })
  it("retains source freshness for the second robot", () => {
    const template = running()
    const robot = {
      robot_id: "robot_2",
      freshness: template.freshness,
      status: "running",
      robot_pose: null,
      battery_remaining: 12,
      samples_collected: 0,
      current_goal: null,
      trajectory: [],
      planned_path: [],
      reservation: null,
      last_error: null,
    }
    const source = {
      ...template,
      team: {
        outcome: "running",
        samples_collected: 0,
        coordinated: true,
        lost_robots: [],
        robots: [robot],
      },
    }
    expect(parseSnapshot(source).team?.robots[0]?.freshness).toEqual(template.freshness)
  })
})
