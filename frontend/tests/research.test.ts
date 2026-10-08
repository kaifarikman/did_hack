import { describe, expect, it } from "vitest"
import stateRunningExample from "../src/adapters/fixture/examples/state-running.json"
import stateSlamRunning from "../src/adapters/fixture/examples/state-slam-running.json"
import stateTeamPartial from "../src/adapters/fixture/examples/state-team-partial.json"
import { ContractError, parseJournalPage, parseSnapshot } from "../src/domain/validation"

function legacySnapshot(): Record<string, unknown> {
  const copy = structuredClone(stateRunningExample) as Record<string, unknown>
  for (const key of ["mission_text", "target_samples", "plan", "research"]) delete copy[key]
  copy.schema_version = "1.0"
  copy.terrain_estimates = (copy.terrain_estimates as Array<Record<string, unknown>>).map(
    ({ std_energy_per_m: _std, regime: _regime, last_measured_s: _last, ...rest }) => rest,
  )
  return copy
}

describe("contract 1.1: plan and research", () => {
  it("reads the 1.1 example into a plan with steps and a sensor state", () => {
    const snapshot = parseSnapshot(structuredClone(stateRunningExample))
    expect(snapshot.plan?.steps.length).toBeGreaterThan(0)
    expect(snapshot.plan?.steps[0]?.status).toBeDefined()
    expect(snapshot.research?.sensor.state).toBe("ok")
    expect(snapshot.research?.hazards[0]?.detection_id).toBe("hazard-1")
    expect(snapshot.target_samples).toBe(3)
    expect(snapshot.terrain_estimates[0]?.std_energy_per_m).not.toBeNull()
  })

  it("accepts a 1.0 snapshot without new fields using defaults", () => {
    const snapshot = parseSnapshot(legacySnapshot())
    expect(snapshot.plan).toBeNull()
    expect(snapshot.research).toBeNull()
    expect(snapshot.mission_text).toBe("")
    expect(snapshot.terrain_estimates[0]?.std_energy_per_m).toBeNull()
    expect(snapshot.terrain_estimates[0]?.regime).toBe(0)
  })

  it("rejects an unknown step status and sensor quality outside 0..1", () => {
    const badStep = structuredClone(stateRunningExample) as {
      plan: { steps: Array<{ status: string }> }
    }
    const firstStep = badStep.plan.steps[0] as { status: string }
    firstStep.status = "maybe"
    expect(() => parseSnapshot(badStep)).toThrow(ContractError)
    const badSensor = structuredClone(stateRunningExample) as {
      research: { sensor: { quality: number } }
    }
    badSensor.research.sensor.quality = 1.5
    expect(() => parseSnapshot(badSensor)).toThrow(ContractError)
  })

  it("gives empty links to a journal entry without link fields", () => {
    const page = parseJournalPage({
      run_id: "r",
      next_sequence: 1,
      has_more: false,
      entries: [
        {
          sequence: 1,
          simulation_time_s: 1,
          kind: "decision",
          title: "t",
          detail: "d",
          hypothesis_id: null,
          expected: null,
          observed: null,
          conclusion: null,
        },
      ],
    })
    expect(page.entries[0]).toMatchObject({
      plan_id: null,
      detection_id: null,
      experiment_id: null,
      evidence: [],
    })
  })
})

describe("team and SLAM fixtures", () => {
  it("shows each robot outcome in a partial team result", () => {
    const snapshot = parseSnapshot(structuredClone(stateTeamPartial))
    expect(snapshot.team?.robots.map((robot) => robot.robot_id)).toEqual(["robot_1", "robot_2"])
    expect(snapshot.team?.lost_robots).toEqual(["robot_2"])
    expect(["partial", "failed"]).toContain(snapshot.team?.outcome)
    expect(snapshot.status).toBe("failed")
  })

  it("keeps the SLAM map mode and the map version in the id", () => {
    const snapshot = parseSnapshot(structuredClone(stateSlamRunning))
    expect(snapshot.map_mode).toBe("slam")
    expect(snapshot.map_id).toMatch(/#r\d+$/)
  })
})
