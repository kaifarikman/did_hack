import { describe, expect, it } from "vitest"
import { ApiError } from "../../src/application/errors"
import { MissionController } from "../../src/application/missionController"
import {
  ControlledGateway,
  entry,
  exampleMap,
  FakeScheduler,
  flush,
  idle,
  readyHealth,
  snapshotWith,
} from "../support"

describe("export through the controller", () => {
  async function bootRunning() {
    const gateway = new ControlledGateway()
    const scheduler = new FakeScheduler()
    const controller = new MissionController({ gateway, scheduler, generateId: () => "id" })
    controller.start()
    gateway.healthCalls[0]?.deferred.resolve(readyHealth)
    gateway.mapCalls[0]?.deferred.resolve(exampleMap())
    gateway.stateCalls[0]?.deferred.resolve(
      snapshotWith({ run_id: "run-a", revision: 3, status: "completed" }),
    )
    await flush()
    return { gateway, scheduler, controller }
  }

  it("reads every page regardless of the screen filter and returns a file", async () => {
    const { gateway, controller } = await bootRunning()
    gateway.journalCalls[0]?.deferred.resolve({
      run_id: "run-a",
      entries: [entry(1)],
      next_sequence: 1,
      has_more: false,
    })
    await flush()
    const exporting = controller.exportJournal()
    await flush()
    const call = gateway.journalCalls[gateway.journalCalls.length - 1]
    expect(call?.after).toBe(0)
    call?.deferred.resolve({
      run_id: "run-a",
      entries: [entry(1), entry(2)],
      next_sequence: 2,
      has_more: false,
    })
    const result = await exporting
    expect(result?.entry_count).toBe(2)
    expect(controller.getView().exportState.phase).toBe("idle")
  })

  it("a run_id change cancels the export and reports it", async () => {
    const { gateway, scheduler, controller } = await bootRunning()
    const exporting = controller.exportJournal()
    await flush()
    const exportCall = gateway.journalCalls[gateway.journalCalls.length - 1]
    await scheduler.advance(500)
    gateway.stateCalls[gateway.stateCalls.length - 1]?.deferred.resolve(
      snapshotWith({ run_id: "run-b", revision: 1, status: "starting" }),
    )
    await flush()
    exportCall?.deferred.resolve({
      run_id: "run-a",
      entries: [entry(1)],
      next_sequence: 1,
      has_more: true,
    })
    expect(await exporting).toBeNull()
    expect(controller.getView().exportState).toMatchObject({ phase: "cancelled" })
    expect(controller.getView().exportState.message).toEqual({ key: "errors:export.cancelled" })
  })

  it("a read error is reported as an incomplete export without a file", async () => {
    const { gateway, controller } = await bootRunning()
    const exporting = controller.exportJournal()
    await flush()
    gateway.journalCalls[gateway.journalCalls.length - 1]?.deferred.reject(
      new ApiError(503, "x", "failure", true),
    )
    expect(await exporting).toBeNull()
    expect(controller.getView().exportState.phase).toBe("failed")
    expect(controller.getView().exportState).toMatchObject({
      message: { key: "errors:export.failed" },
      cause: { key: "errors:kind.unavailable" },
    })
  })

  it("journal paging on screen follows has_more and drops duplicates", async () => {
    const { gateway, controller } = await bootRunning()
    gateway.journalCalls[0]?.deferred.resolve({
      run_id: "run-a",
      entries: [entry(1), entry(2)],
      next_sequence: 2,
      has_more: true,
    })
    await flush()
    expect(gateway.journalCalls[1]?.after).toBe(2)
    gateway.journalCalls[1]?.deferred.resolve({
      run_id: "run-a",
      entries: [entry(2), entry(3)],
      next_sequence: 3,
      has_more: false,
    })
    await flush()
    const view = controller.getView()
    expect(view.journal.entries.map((item) => item.sequence)).toEqual([1, 2, 3])
    expect(view.journal.nextSequence).toBe(3)
    expect(gateway.journalCalls).toHaveLength(2)
    void idle
  })
})
