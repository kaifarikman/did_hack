import { describe, expect, it } from "vitest"
import { FIXTURE_SCENARIOS } from "../../src/adapters/fixture/catalog"
import gatewayContent from "../../src/adapters/fixture/examples/content/gateway.json"
import { FixtureMissionGateway } from "../../src/adapters/fixture/fixtureGateway"
import { OUTAGE_REQUEST_COUNT } from "../../src/adapters/fixture/scenarios/disconnect"
import { NetworkError } from "../../src/application/errors"
import {
  instantWait,
  isFinished,
  lastOf,
  playUntilFinished,
  startScenario,
} from "./gatewayDriver"

describe("fixture gateway: mission playback", () => {
  it("success collects before returning, completes, and never lowers revision", async () => {
    const { gateway, first } = await startScenario("success")
    expect(first.status).toBe("starting")
    expect(first.robot_pose).toBeNull()
    const { frames } = await playUntilFinished(gateway)
    const last = lastOf(frames)
    expect(last.status).toBe("completed")
    expect(last.samples_collected).toBe(1)
    expect(last.team).toBeNull()
    const revisions = frames.map((frame) => frame.revision)
    expect(revisions).toEqual([...revisions].sort((first, second) => first - second))
    const firstCollect = frames.findIndex((frame) => frame.samples_collected > 0)
    const firstReturn = frames.findIndex((frame) => frame.status === "returning")
    expect(firstCollect).toBeLessThanOrEqual(firstReturn)
    expect(last.battery_remaining ?? 0).toBeGreaterThan(0)
  })

  it("llm_fallback switches the planner to fallback and still completes", async () => {
    const { gateway } = await startScenario("llm_fallback")
    const { frames } = await playUntilFinished(gateway)
    expect(frames.some((frame) => frame.planner_mode === "llm")).toBe(true)
    expect(frames.some((frame) => frame.last_error?.code === "llm_timeout")).toBe(true)
    expect(lastOf(frames).planner_mode).toBe("fallback")
    expect(lastOf(frames).plan?.fallback_reason).not.toBeNull()
    expect(lastOf(frames).status).toBe("completed")
  })

  it("failed ends with a non-retryable error after a retryable one", async () => {
    const { gateway } = await startScenario("failed")
    const { frames } = await playUntilFinished(gateway)
    expect(lastOf(frames).status).toBe("failed")
    expect(lastOf(frames).last_error?.code).toBe("ros_connection_lost")
    expect(frames.some((frame) => frame.last_error?.retryable === true)).toBe(true)
    expect(lastOf(frames).team?.outcome).toBe("failed")
  })

  it("stopped plays stopping then stopped with a team outcome", async () => {
    const { gateway } = await startScenario("stopped")
    const { frames } = await playUntilFinished(gateway)
    expect(frames.map((frame) => frame.status).slice(-2)).toEqual(["stopping", "stopped"])
    expect(lastOf(frames).team?.outcome).toBe("stopped")
  })

  it("team_partial loses the partner and ends partial", async () => {
    const { gateway } = await startScenario("team_partial")
    const { frames } = await playUntilFinished(gateway)
    const team = lastOf(frames).team
    expect(team?.outcome).toBe("partial")
    expect(team?.coordinated).toBe(false)
    expect(team?.lost_robots).toEqual(["robot_2"])
  })
})

describe("fixture gateway: connection and commands", () => {
  it("disconnect fails longer than the stale threshold, then recovers", async () => {
    const { gateway, runId } = await startScenario("disconnect")
    let healthFailed = false
    let journalFailed = false
    let failures = 0
    let finished = false
    for (let step = 0; step < 200 && !finished; step += 1) {
      try {
        finished = isFinished(await gateway.getState())
        await gateway.getJournalPage(runId, 0, 100).catch(() => {
          journalFailed = true
        })
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError)
        failures += 1
        await gateway.getHealth().catch(() => {
          healthFailed = true
        })
      }
    }
    expect(failures).toBe(OUTAGE_REQUEST_COUNT)
    expect(OUTAGE_REQUEST_COUNT * 0.5).toBeGreaterThan(9)
    expect([healthFailed, journalFailed, finished]).toEqual([true, true, true])
  })

  it("start_rejected rejects once with 503; a repeated request_id is idempotent", async () => {
    const gateway = new FixtureMissionGateway({ wait: instantWait })
    gateway.setScenario("start_rejected")
    await expect(
      gateway.startRun({ request_id: "a", scenario: "easy", seed: 1 }),
    ).rejects.toMatchObject({
      status: 503,
      retryable: true,
    })
    const started = await gateway.startRun({ request_id: "b", scenario: "easy", seed: 1 })
    const repeated = await gateway.startRun({ request_id: "b", scenario: "easy", seed: 1 })
    expect(repeated.run_id).toBe(started.run_id)
  })

  it("env_starting rejects start until health becomes ready", async () => {
    const gateway = new FixtureMissionGateway({ wait: instantWait })
    gateway.setScenario("env_starting")
    const first = await gateway.getHealth()
    expect([first.status, first.ros_connected, first.llm_available]).toEqual([
      "starting",
      false,
      false,
    ])
    const request = { request_id: "a", scenario: "easy" as const, seed: 1 }
    await expect(gateway.startRun(request)).rejects.toMatchObject({ status: 503 })
    let health = first
    for (let call = 0; call < 20 && health.status !== "ready"; call += 1)
      health = await gateway.getHealth()
    expect(health.llm_available).toBe(false)
    const started = await gateway.startRun({ ...request, request_id: "b" })
    expect(started.status).toBe("starting")
  })

  it("manual stop goes stopping then stopped and logs the decision", async () => {
    const { gateway, runId } = await startScenario("success")
    for (let index = 0; index < 5; index += 1) await gateway.getState()
    const accepted = await gateway.stopRun(runId, { request_id: "s1" })
    expect(accepted.status).toBe("running")
    const statuses = [(await gateway.getState()).status, (await gateway.getState()).status]
    expect(statuses).toEqual(["stopping", "stopped"])
    const page = await gateway.getJournalPage(runId, 0, 200)
    expect(page.entries.at(-1)?.title).toBe(gatewayContent.stopDecision.title)
  })

  it("command_unknown times out the first stop without applying it", async () => {
    const { gateway, runId } = await startScenario("command_unknown")
    for (let index = 0; index < 5; index += 1) await gateway.getState()
    await expect(gateway.stopRun(runId, { request_id: "s1" })).rejects.toMatchObject({
      name: "RequestTimeoutError",
    })
    expect((await gateway.getState()).status).toBe("running")
    await gateway.stopRun(runId, { request_id: "s1" })
    expect((await gateway.getState()).status).toBe("stopping")
  })

  it("lists all sixteen scenarios", () => {
    expect(FIXTURE_SCENARIOS).toHaveLength(16)
    expect(new Set(FIXTURE_SCENARIOS).size).toBe(16)
  })
})
