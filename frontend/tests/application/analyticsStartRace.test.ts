import { describe, expect, it } from "vitest"
import { analyticsRun } from "@/application/analytics"
import { ApiError } from "@/application/errors"
import type { MissionSnapshot } from "@/domain/contract"
import { flush, idle } from "../support"
import { answerState, boot, lastOf, runA } from "./controllerHarness"

async function delayedStart(newerPoll: MissionSnapshot) {
  const harness = await boot()
  const pending = harness.controller.startRun(3)
  await harness.scheduler.advance(500)
  await answerState(harness, newerPoll)
  return { harness, pending }
}

describe("Start response racing a later state poll", () => {
  it("accepts a new run when the later poll still observed the pre-start idle state", async () => {
    const { harness, pending } = await delayedStart(idle())
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
    expect(harness.controller.getView().command.phase).toBe("idle")
    expect(analyticsRun(harness.controller.getView())?.snapshot.run_id).toBe("run-a")
    harness.controller.dispose()
  })

  it("does not overwrite a different run accepted by a later poll", async () => {
    const newer = runA({ run_id: "competing-run", generation: 4, revision: 20 })
    const { harness, pending } = await delayedStart(newer)
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
    expect(analyticsRun(harness.controller.getView())?.snapshot).toEqual(newer)
    harness.controller.dispose()
  })

  it.each(["running", "completed", "failed", "stopped"] as const)(
    "does not roll a newer same-run %s snapshot back to starting",
    async (status) => {
      const newer = runA({ revision: 20, status })
      const { harness, pending } = await delayedStart(newer)
      lastOf(harness.gateway.startCalls).deferred.resolve(
        runA({ revision: 1, status: "starting" }),
      )
      await pending
      expect(analyticsRun(harness.controller.getView())?.snapshot).toEqual(newer)
      harness.controller.dispose()
    },
  )

  it("does not restore pre-start idle from a poll already pending before acceptance", async () => {
    const { harness, pending } = await delayedStart(idle())
    await harness.scheduler.advance(500)
    const slowPoll = lastOf(harness.gateway.stateCalls)
    lastOf(harness.gateway.startCalls).deferred.resolve(
      runA({ revision: 1, status: "starting" }),
    )
    await pending
    slowPoll.deferred.resolve(idle())
    await flush()
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a")
    expect(analyticsRun(harness.controller.getView())?.snapshot.run_id).toBe("run-a")
    await harness.scheduler.advance(500)
    await answerState(harness, idle())
    expect(harness.controller.getView().snapshot?.run_id).toBeNull()
    expect(analyticsRun(harness.controller.getView())?.retained).toBe(true)
    harness.controller.dispose()
  })

  it("leaves authoritative idle after a rejected Start", async () => {
    const { harness, pending } = await delayedStart(idle())
    lastOf(harness.gateway.startCalls).deferred.reject(
      new ApiError(503, "offline", "offline", true),
    )
    await pending
    expect(harness.controller.getView().snapshot?.run_id).toBeNull()
    expect(harness.controller.getView().command.phase).toBe("failed")
    expect(analyticsRun(harness.controller.getView())).toBeNull()
    harness.controller.dispose()
  })
})
