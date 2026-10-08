import { describe, expect, it } from "vitest"
import { isMapMismatch } from "../../src/domain/status"
import { entry, exampleMap, flush, idle, snapshotWith } from "../support"
import { answerState, boot, create, failState, lastOf, runA } from "./controllerHarness"

describe("state polling", () => {
  it("does not run parallel state requests", async () => {
    const harness = create()
    harness.controller.start()
    await harness.scheduler.advance(5000)
    expect(harness.gateway.stateCalls).toHaveLength(1)
    await answerState(harness, idle())
    await harness.scheduler.advance(500)
    expect(harness.gateway.stateCalls).toHaveLength(2)
    await harness.scheduler.advance(2000)
    expect(harness.gateway.stateCalls).toHaveLength(2)
  })

  it("a response with a lower revision does not roll the state back", async () => {
    const harness = await boot(runA({ revision: 12 }))
    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 5, battery_remaining: 1 }))
    const view = harness.controller.getView()
    expect(view.snapshot?.revision).toBe(12)
    expect(view.snapshot?.battery_remaining).not.toBe(1)
    expect(view.connection).toBe("live")
  })

  it("a run change clears the journal and the chosen hypothesis; a late response of the old run brings no entries back", async () => {
    const harness = await boot(runA())
    const oldJournal = lastOf(harness.gateway.journalCalls)
    expect(oldJournal.runId).toBe("run-a")
    oldJournal.deferred.resolve({
      run_id: "run-a",
      entries: [entry(1, { hypothesis_id: "h1" })],
      next_sequence: 1,
      has_more: false,
    })
    await flush()
    harness.controller.selectHypothesis("h1")
    expect(harness.controller.getView().journal.entries).toHaveLength(1)

    await harness.scheduler.advance(500)
    const pendingOld = lastOf(harness.gateway.journalCalls)
    await answerState(
      harness,
      snapshotWith({ run_id: "run-b", revision: 1, status: "starting" }),
    )
    const view = harness.controller.getView()
    expect(view.journal.runId).toBe("run-b")
    expect(view.journal.entries).toEqual([])
    expect(view.selectedHypothesisId).toBeNull()

    pendingOld.deferred.resolve({
      run_id: "run-a",
      entries: [entry(2)],
      next_sequence: 2,
      has_more: false,
    })
    await flush()
    expect(harness.controller.getView().journal.entries).toEqual([])
    expect(harness.controller.getView().journal.runId).toBe("run-b")
  })

  it("error, then stale after 3 s, then recovery", async () => {
    const harness = await boot(runA())
    await harness.scheduler.advance(500)
    await failState(harness)
    expect(harness.controller.getView().connection).toBe("live")
    await harness.scheduler.advance(2000)
    await failState(harness)
    await harness.scheduler.advance(600)
    const stale = harness.controller.getView()
    expect(stale.connection).toBe("stale")
    expect(stale.snapshot?.run_id).toBe("run-a")
    expect(stale.connectionError).toMatchObject({ key: "errors:kind.network" })

    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 11 }))
    const recovered = harness.controller.getView()
    expect(recovered.connection).toBe("live")
    expect(recovered.snapshot?.revision).toBe(11)
    const callsBefore = harness.gateway.stateCalls.length
    await harness.scheduler.advance(500)
    expect(harness.gateway.stateCalls.length).toBe(callsBefore + 1)
  })

  it("a paused simulation clock is not a lost connection", async () => {
    const harness = await boot(runA({ simulation_time_s: 18.5 }))
    for (let tick = 0; tick < 12; tick += 1) {
      await harness.scheduler.advance(500)
      await answerState(harness, runA({ simulation_time_s: 18.5 }))
    }
    expect(harness.controller.getView().connection).toBe("live")
  })

  it("dispose frees timers, aborts requests and ignores late responses", async () => {
    const harness = await boot(runA())
    await harness.scheduler.advance(500)
    const pendingState = lastOf(harness.gateway.stateCalls)
    harness.controller.dispose()
    expect(harness.scheduler.pendingTimers).toBe(0)
    expect(pendingState.signal?.aborted).toBe(true)
    const before = harness.notifications.count
    pendingState.deferred.resolve(runA({ revision: 99 }))
    await flush()
    expect(harness.notifications.count).toBe(before)
    expect(harness.controller.getView().snapshot?.revision).toBe(10)
    expect(harness.scheduler.pendingTimers).toBe(0)
  })

  it("start after dispose works again (StrictMode)", async () => {
    const harness = await boot()
    harness.controller.dispose()
    harness.controller.start()
    const call = lastOf(harness.gateway.stateCalls)
    call.deferred.resolve(runA())
    await flush()
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a")
  })
})

describe("map", () => {
  it("a map_id mismatch is visible until the matching map loads, then the map is fetched", async () => {
    const harness = await boot(idle())
    await harness.scheduler.advance(500)
    await answerState(harness, snapshotWith({ run_id: "run-a", revision: 3, map_id: "map-v2" }))
    let view = harness.controller.getView()
    expect(isMapMismatch(view.snapshot, view.map)).toBe(true)
    const mapCalls = harness.gateway.mapCalls.length

    await harness.scheduler.advance(2000)
    await answerState(harness, snapshotWith({ run_id: "run-a", revision: 4, map_id: "map-v2" }))
    expect(harness.gateway.mapCalls.length).toBe(mapCalls + 1)
    lastOf(harness.gateway.mapCalls).deferred.resolve({ ...exampleMap(), map_id: "map-v2" })
    await flush()
    view = harness.controller.getView()
    expect(isMapMismatch(view.snapshot, view.map)).toBe(false)
  })
})
