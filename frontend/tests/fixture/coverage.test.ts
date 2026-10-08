import { describe, expect, it } from "vitest"
import {
  type GoalKind,
  type JournalKind,
  type JudgeMode,
  MAP_MODES,
  type PlannerMode,
  type RunStatus,
  SCENARIOS,
  SENSOR_FAULTS,
  SENSOR_STATES,
  STEP_STATUSES,
  TEAM_OUTCOMES,
} from "../../src/domain/contract"
import {
  ALL_SCRIPTS,
  allEntries,
  allHealth,
  allMaps,
  allRobots,
  allSnapshots,
  scriptFor,
} from "./scenarioData"

const RUN_STATUSES: RunStatus[] = [
  "idle",
  "starting",
  "running",
  "returning",
  "stopping",
  "completed",
  "stopped",
  "failed",
]
const GOAL_KINDS: GoalKind[] = ["explore", "approach", "collect", "return"]
const JOURNAL_KINDS: JournalKind[] = [
  "observation",
  "hypothesis",
  "experiment",
  "decision",
  "outcome",
  "error",
]
const PLANNER_MODES: PlannerMode[] = ["llm", "fallback"]
const JUDGE_MODES: JudgeMode[] = ["local", "official"]
const HYPOTHESIS_STATUSES = [
  "proposed",
  "testing",
  "confirmed",
  "refuted",
  "deferred",
  "unverified",
]
const HYPOTHESIS_KINDS = ["costly_terrain", "terrain_change"]

const snapshots = allSnapshots()
const research = snapshots.flatMap((snapshot) =>
  snapshot.research === null ? [] : [snapshot.research],
)

function expectCovers<T>(seen: readonly T[], expected: readonly T[]): void {
  for (const value of expected) expect(seen, String(value)).toContain(value)
}

describe("fixture scenarios cover every contract value", () => {
  it("run statuses of missions and team robots", () => {
    expectCovers(
      snapshots.map((snapshot) => snapshot.status),
      RUN_STATUSES,
    )
    expectCovers(
      allRobots().map((robot) => robot.status),
      ["starting", "running", "returning", "completed", "failed", "stopped"],
    )
  })

  it("scenario profiles, map modes, planner and judge modes", () => {
    expectCovers(
      snapshots.map((snapshot) => snapshot.scenario),
      SCENARIOS,
    )
    expectCovers(
      snapshots.map((snapshot) => snapshot.map_mode),
      MAP_MODES,
    )
    expectCovers(
      snapshots.map((snapshot) => snapshot.planner_mode),
      PLANNER_MODES,
    )
    expectCovers(
      snapshots.map((snapshot) => snapshot.judge_mode),
      JUDGE_MODES,
    )
    expectCovers(
      allMaps().map((map) => map.map_id.startsWith("fixture-slam")),
      [true, false],
    )
  })

  it("goal kinds including a missing goal", () => {
    expectCovers(
      snapshots.map((snapshot) => snapshot.current_goal?.kind ?? null),
      [...GOAL_KINDS, null],
    )
  })

  it("plan sources and every step status", () => {
    const plans = snapshots.flatMap((snapshot) =>
      snapshot.plan === null ? [] : [snapshot.plan],
    )
    expectCovers(
      plans.map((plan) => plan.source),
      PLANNER_MODES,
    )
    expectCovers(
      plans.flatMap((plan) => plan.steps.map((step) => step.status)),
      STEP_STATUSES,
    )
    expect(plans.some((plan) => plan.fallback_reason !== null)).toBe(true)
    expect(plans.some((plan) => plan.revision_reason !== null)).toBe(true)
    expect(plans.some((plan) => plan.steps.some((step) => step.revise_if !== null))).toBe(true)
  })

  it("every sensor state with every fault", () => {
    const pairs = research.map(({ sensor }) => `${sensor.state}:${sensor.fault ?? "none"}`)
    const faulty = SENSOR_STATES.filter((state) => state !== "ok").flatMap((state) =>
      SENSOR_FAULTS.map((fault) => `${state}:${fault}`),
    )
    expectCovers(pairs, ["ok:none", ...faulty])
  })

  it("hypothesis statuses, kinds and links", () => {
    const hypotheses = research.flatMap((item) => item.hypotheses)
    expectCovers(
      hypotheses.map((item) => item.status),
      HYPOTHESIS_STATUSES,
    )
    expectCovers(
      hypotheses.map((item) => item.kind),
      HYPOTHESIS_KINDS,
    )
    expect(hypotheses.some((item) => item.detection_id !== null)).toBe(true)
    expect(hypotheses.some((item) => item.experiment_id !== null)).toBe(true)
  })

  it("team outcomes, lost robots and reservations", () => {
    const teams = snapshots.flatMap((snapshot) =>
      snapshot.team === null ? [] : [snapshot.team],
    )
    expectCovers(
      teams.map((team) => team.outcome),
      TEAM_OUTCOMES,
    )
    expectCovers(
      teams.map((team) => team.coordinated),
      [true, false],
    )
    expect(teams.some((team) => team.lost_robots.length > 0)).toBe(true)
    expect(allRobots().some((robot) => robot.reservation !== null)).toBe(true)
    expect(
      snapshots.some((snapshot) => snapshot.team === null && snapshot.status === "running"),
    ).toBe(true)
  })

  it("journal kinds and hypothesis chains", () => {
    const entries = allEntries()
    expectCovers(
      entries.map((entry) => entry.kind),
      JOURNAL_KINDS,
    )
    expect(entries.some((entry) => entry.expected !== null)).toBe(true)
    expect(entries.some((entry) => entry.observed !== null)).toBe(true)
    expect(entries.some((entry) => entry.conclusion !== null)).toBe(true)
    expect(entries.some((entry) => entry.detection_id !== null)).toBe(true)
    expect(entries.some((entry) => entry.plan_id !== null)).toBe(true)
    expect(entries.some((entry) => entry.evidence.length > 0)).toBe(true)
  })

  it("health readiness, ROS and LLM availability", () => {
    const health = allHealth()
    expectCovers(
      health.map((item) => item.status),
      ["ready", "starting"],
    )
    expectCovers(
      health.map((item) => item.ros_connected),
      [true, false],
    )
    expectCovers(
      health.map((item) => item.llm_available),
      [true, false],
    )
    expect(health.some((item) => item.supported_robot_counts.includes(2))).toBe(true)
  })

  it("errors, missing values and battery below the return reserve", () => {
    const errors = snapshots.flatMap((snapshot) =>
      snapshot.last_error === null ? [] : [snapshot.last_error],
    )
    expectCovers(
      errors.map((error) => error.retryable),
      [true, false],
    )
    expect(snapshots.some((snapshot) => snapshot.battery_remaining === null)).toBe(true)
    expect(snapshots.some((snapshot) => snapshot.robot_pose === null)).toBe(true)
    expect(
      snapshots.some(
        (snapshot) => snapshot.sample_signal === null && snapshot.status === "returning",
      ),
    ).toBe(true)
    const lowBattery = snapshots.some(
      (snapshot) =>
        snapshot.battery_remaining !== null &&
        snapshot.return_energy_estimate !== null &&
        snapshot.battery_remaining < snapshot.return_energy_estimate,
    )
    expect(lowBattery).toBe(true)
  })

  it("terrain regimes, hazards with repeated hits and collected samples", () => {
    const estimates = snapshots.flatMap((snapshot) => snapshot.terrain_estimates)
    expectCovers(
      estimates.map((estimate) => estimate.regime),
      [0, 1],
    )
    const hits = research.flatMap((item) => item.hazards.map((hazard) => hazard.hits))
    expect(Math.max(...hits)).toBeGreaterThan(1)
    expect(snapshots.some((snapshot) => snapshot.collected_samples.length > 0)).toBe(true)
    expect(research.some((item) => item.last_replan_detection_id !== null)).toBe(true)
  })

  it("journal_long has hundreds of entries and slam has a gap without a map", () => {
    expect(scriptFor("journal_long").journal.length).toBeGreaterThan(400)
    expect(scriptFor("slam_building").maps.some((revision) => revision.map === null)).toBe(true)
    expect(ALL_SCRIPTS).toHaveLength(21)
  })
})
