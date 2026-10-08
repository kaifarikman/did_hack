import { describe, expect, it } from "vitest"
import { ApiError, NetworkError, RequestTimeoutError } from "../../src/application/errors"
import { flush, idle } from "../support"
import { answerState, boot, create, failState, lastOf, runA } from "./controllerHarness"

describe("commands", () => {
  it("a double click on Start sends one command", async () => {
    const harness = await boot()
    const first = harness.controller.startRun(42)
    const second = harness.controller.startRun(42)
    await flush()
    expect(harness.gateway.startCalls).toHaveLength(1)
    expect(harness.gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "easy",
      seed: 42,
    })
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await Promise.all([first, second])
    expect(harness.controller.getView().command.phase).toBe("idle")
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a")
  })

  it("Start sends the chosen profile and mission text", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(9, "hard", "  collect two samples  ")
    await flush()
    expect(harness.gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "hard",
      seed: 9,
      mission_text: "collect two samples",
    })
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
  })

  it("Start sends the SLAM mode only when it is chosen", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(4, "easy", "", "slam")
    await flush()
    expect(harness.gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "easy",
      seed: 4,
      map_mode: "slam",
    })
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
  })

  it("Start is unavailable without a ready environment or a fresh connection", async () => {
    const harness = create()
    harness.controller.start()
    await answerState(harness, idle())
    await harness.controller.startRun(1)
    expect(harness.gateway.startCalls).toHaveLength(0)
  })

  it("202 with the old state waits for the transition; success is not shown before the state", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(7)
    lastOf(harness.gateway.startCalls).deferred.resolve(idle())
    await pending
    expect(harness.controller.getView().command.phase).toBe("awaiting")
    expect(harness.controller.getView().snapshot?.status).toBe("idle")

    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 1, status: "starting" }))
    expect(harness.controller.getView().command.phase).toBe("idle")
    expect(harness.controller.getView().snapshot?.status).toBe("starting")
  })

  it("waiting for the transition does not block forever", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(7)
    lastOf(harness.gateway.startCalls).deferred.resolve(idle())
    await pending
    for (let tick = 0; tick < 25; tick += 1) {
      await harness.scheduler.advance(500)
      await answerState(harness, idle())
    }
    expect(harness.controller.getView().command.phase).toBe("failed")
  })

  it("an unknown outcome after a timeout is reconciled with /state and retried with the same request_id", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(5)
    lastOf(harness.gateway.startCalls).deferred.reject(new RequestTimeoutError())
    await pending
    expect(harness.controller.getView().command).toMatchObject({
      phase: "unknown",
      canRetry: false,
    })
    await harness.controller.retryCommand()
    expect(harness.gateway.startCalls).toHaveLength(1)

    await harness.scheduler.advance(500)
    await answerState(harness, idle())
    expect(harness.controller.getView().command.canRetry).toBe(true)

    const retry = harness.controller.retryCommand()
    await flush()
    expect(harness.gateway.startCalls).toHaveLength(2)
    expect(harness.gateway.startCalls[1]?.request).toEqual(
      harness.gateway.startCalls[0]?.request,
    )
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await retry
    expect(harness.controller.getView().command.phase).toBe("idle")
  })

  it("after a disconnect /state is checked first: a start accepted by the server is confirmed without a retry", async () => {
    const harness = await boot()
    const pending = harness.controller.startRun(5)
    lastOf(harness.gateway.startCalls).deferred.reject(new NetworkError())
    await pending
    await harness.scheduler.advance(500)
    await failState(harness)
    await harness.scheduler.advance(3000)
    await failState(harness)
    expect(harness.controller.getView().connection).toBe("stale")
    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 2 }))
    expect(harness.controller.getView().command.phase).toBe("idle")
    expect(harness.gateway.startCalls).toHaveLength(1)
  })

  it.each([
    [409, "errors:kind.conflict"],
    [422, "errors:kind.rejected"],
    [503, "errors:kind.unavailable"],
  ])("error %i gives a readable message and allows a retry", async (status, key) => {
    const harness = await boot()
    const pending = harness.controller.startRun(5)
    lastOf(harness.gateway.startCalls).deferred.reject(
      new ApiError(status, "code", "details", true),
    )
    await pending
    const { command } = harness.controller.getView()
    expect(command.phase).toBe("failed")
    expect(command.message).toEqual({ key, params: { detail: "details" } })
    const again = harness.controller.startRun(5)
    await flush()
    expect(harness.gateway.startCalls).toHaveLength(2)
    expect(harness.gateway.startCalls[1]?.request.request_id).not.toBe(
      harness.gateway.startCalls[0]?.request.request_id,
    )
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await again
  })

  it("Stop sends the abort once and waits for stopping/stopped", async () => {
    const harness = await boot(runA())
    const first = harness.controller.stopRun()
    const second = harness.controller.stopRun()
    await flush()
    expect(harness.gateway.stopCalls).toHaveLength(1)
    expect(harness.gateway.stopCalls[0]).toMatchObject({ runId: "run-a" })
    lastOf(harness.gateway.stopCalls).deferred.resolve(runA({ revision: 11 }))
    await Promise.all([first, second])
    expect(harness.controller.getView().command.phase).toBe("awaiting")
    await harness.controller.stopRun()
    expect(harness.gateway.stopCalls).toHaveLength(1)

    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 12, status: "stopping" }))
    expect(harness.controller.getView().command.phase).toBe("idle")
    await harness.scheduler.advance(500)
    await answerState(harness, runA({ revision: 13, status: "stopped" }))
    expect(harness.controller.getView().snapshot?.status).toBe("stopped")
  })

  it("a late state response sent before the command does not roll back the new run", async () => {
    const harness = await boot()
    await harness.scheduler.advance(500)
    const slowPoll = lastOf(harness.gateway.stateCalls)
    const pending = harness.controller.startRun(3)
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
    slowPoll.deferred.resolve(idle())
    await flush()
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a")
  })
})
