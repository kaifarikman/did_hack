import { describe, expect, it } from "vitest"
import { activeHypothesis, runAnalytics } from "@/application/analytics"
import { readAnalytics } from "@/domain/parsing/analytics"
import type { RunAnalytics } from "@/domain/runAnalytics"
import { chartPath, chartSeries } from "@/ui/features/analytics/metric-chart/geometry"
import { snapshotWith } from "../support"

const analyticsExample: RunAnalytics = {
  summary: {
    run_id: "analytics-run",
    robot_id: "robot_1",
    generation: 1,
    observation_sequence: 2,
    simulation_time_s: 1,
    distance_m: 0.1,
    speed_mps: 0.1,
    reserve_energy: 3,
    available_energy: 40,
    elapsed_sim_s: 1,
    elapsed_wall_s: 2,
    real_time_factor: 0.5,
    phase: "moving",
    phase_seconds: [["moving", 1]],
    planner: { requests: 1, deadline_timeouts: 0, fallbacks: 0, last_wait_wall_s: 0.1 },
  },
  history: [0, 1, 2].map((moment) => ({
    simulation_time_s: moment,
    battery_remaining: 50 - moment,
    return_energy: 8,
    sample_signal: null,
    speed_mps: 0.1,
    phase: "moving",
    continuous: moment > 0,
  })),
  history_limit: 180,
  sample_interval_s: 1,
}

describe("run analytics", () => {
  it("accepts the bounded contract and rejects nonfinite numbers", () => {
    expect(readAnalytics(analyticsExample, "analytics")).toEqual(analyticsExample)
    expect(() =>
      readAnalytics(
        {
          ...analyticsExample,
          summary: { ...analyticsExample.summary, distance_m: Number.NaN },
        },
        "analytics",
      ),
    ).toThrow()
    expect(() =>
      readAnalytics(
        { ...analyticsExample, history: Array(181).fill(analyticsExample.history[0]) },
        "analytics",
      ),
    ).toThrow()
  })
  it("rejects metrics from a different run, robot or generation", () => {
    const snapshot = snapshotWith({
      run_id: "analytics-run",
      generation: 1,
      analytics: analyticsExample,
    })
    expect(runAnalytics(snapshot)).toBe(analyticsExample)
    for (const patch of [{ run_id: "old" }, { robot_id: "robot_2" }, { generation: 2 }])
      expect(runAnalytics({ ...snapshot, ...patch })).toBeNull()
  })
  it("selects only the explicitly active experiment and clears it after stop", () => {
    const snapshot = snapshotWith({
      research: {
        sensor: { state: "ok", fault: null, quality: 1 },
        hazards: [],
        hypotheses: ["old", "active"].map((hypothesis_id) => ({
          hypothesis_id,
          kind: "costly_terrain",
          status: "testing",
          center: { position_x_m: 0, position_y_m: 0 },
          prediction: "Prediction",
          measurement: null,
          detection_id: null,
          experiment_id: "experiment",
        })),
        active_hypothesis_id: "active",
        last_replan_reason: null,
        last_replan_detection_id: null,
        planner_requests: 0,
      },
    })
    expect(activeHypothesis(snapshot)?.hypothesis_id).toBe("active")
    expect(activeHypothesis({ ...snapshot, status: "stopped" })).toBeNull()
    if (snapshot.research === null) throw new Error("Research required")
    expect(
      activeHypothesis({
        ...snapshot,
        research: { ...snapshot.research, active_hypothesis_id: null },
      }),
    ).toBeNull()
  })
  it("breaks chart lines at gaps and absent values", () => {
    const points = analyticsExample.history.map((point, index) => ({
      ...point,
      continuous: index !== 2,
    }))
    expect(chartPath(points, "battery_remaining", 60).match(/M/g)).toHaveLength(2)
    expect(
      chartPath(
        points.map((point, index) => ({
          ...point,
          battery_remaining: index === 1 ? null : 50,
        })),
        "battery_remaining",
        60,
      ).match(/M/g),
    ).toHaveLength(2)
    expect(chartPath(points, "sample_signal", 1).trim()).toBe("")
  })
  it("does not mark events outside the retained interval", () => {
    expect(chartSeries(analyticsExample.history, "energy", "window", 90).marker).toBeNull()
    expect(chartSeries(analyticsExample.history, "energy", "window", 1).marker).not.toBeNull()
  })
})
