import { describe, expect, it } from "vitest"
import * as analyticsSelection from "@/application/analytics"
import { activeHypothesis } from "@/application/analytics"
import { ApiError } from "@/application/errors"
import { INITIAL_VIEW } from "@/application/viewState"
import {
  experimentSnapshot,
  finishedExperiment,
  testingExperiment,
} from "../analyticsSnapshots"
import { entry, idle } from "../support"
import { answerState, boot, lastOf } from "./controllerHarness"

describe("experiment selection across the run lifecycle", () => {
  it("selects the active experiment before optional metrics arrive", () => {
    expect(analyticsSelection.experimentView(experimentSnapshot())).toEqual({
      phase: "active",
      hypothesis: testingExperiment,
    })
  })
  it.each(["running", "returning", "completed", "failed", "stopped"] as const)(
    "retains the last finished experiment when active ID is null in %s",
    (status) => {
      const snapshot = experimentSnapshot(
        { status },
        {
          active_hypothesis_id: null,
          hypotheses: [finishedExperiment],
        },
      )
      expect(analyticsSelection.experimentView(snapshot)).toEqual({
        phase: "last",
        hypothesis: finishedExperiment,
      })
      expect(activeHypothesis(snapshot)).toBeNull()
    },
  )
  it("uses experiment journal chronology rather than backend hypothesis grouping", () => {
    const newest = {
      ...finishedExperiment,
      hypothesis_id: "terrain-latest",
      experiment_id: "terrain-experiment",
    }
    const snapshot = experimentSnapshot(
      {},
      {
        active_hypothesis_id: null,
        hypotheses: [newest, finishedExperiment],
      },
    )
    const entries = [
      entry(10, {
        kind: "experiment",
        hypothesis_id: finishedExperiment.hypothesis_id,
        experiment_id: finishedExperiment.experiment_id,
      }),
      entry(20, {
        kind: "experiment",
        hypothesis_id: newest.hypothesis_id,
        experiment_id: newest.experiment_id,
      }),
    ]
    expect(analyticsSelection.experimentView(snapshot, entries).hypothesis).toBe(newest)
  })
  it("does not promote a proposed hypothesis to the last completed experiment", () => {
    const proposal = { ...testingExperiment, status: "proposed", experiment_id: null }
    const snapshot = experimentSnapshot(
      {},
      {
        active_hypothesis_id: null,
        hypotheses: [finishedExperiment, proposal],
      },
    )
    expect(analyticsSelection.experimentView(snapshot).hypothesis).toBe(finishedExperiment)
  })
  it("does not call a running run idle when no experiment has started", () => {
    expect(
      analyticsSelection.experimentView(
        experimentSnapshot(
          {},
          {
            hypotheses: [],
            active_hypothesis_id: null,
          },
        ),
      ),
    ).toEqual({ phase: "waiting", hypothesis: null })
  })
  it("does not expose a completed result as the explicitly active hypothesis", () => {
    const snapshot = experimentSnapshot(
      {},
      {
        hypotheses: [finishedExperiment],
        active_hypothesis_id: finishedExperiment.hypothesis_id,
      },
    )
    expect(activeHypothesis(snapshot)).toBeNull()
    expect(analyticsSelection.experimentView(snapshot).phase).toBe("last")
  })
  it("preserves the terminal experiment after a rejected new start and clears it after acceptance", async () => {
    const previous = experimentSnapshot(
      { status: "completed" },
      {
        hypotheses: [finishedExperiment],
        active_hypothesis_id: null,
      },
    )
    const harness = await boot(previous)
    const rejected = harness.controller.startRun(7)
    lastOf(harness.gateway.startCalls).deferred.reject(
      new ApiError(503, "unavailable", "offline", true),
    )
    await rejected
    expect(harness.controller.getView().snapshot).toEqual(previous)
    expect(analyticsSelection.experimentView(previous).hypothesis).toBe(finishedExperiment)
    const accepted = harness.controller.startRun(8)
    lastOf(harness.gateway.startCalls).deferred.resolve(
      experimentSnapshot(
        {
          run_id: "next-run",
          generation: 4,
          revision: 1,
          status: "starting",
        },
        { hypotheses: [], active_hypothesis_id: null },
      ),
    )
    await accepted
    const current = harness.controller.getView().snapshot
    if (current === null) throw new Error("Accepted run requires snapshot")
    expect(current.run_id).toBe("next-run")
    expect(analyticsSelection.experimentView(current)).toEqual({
      phase: "waiting",
      hypothesis: null,
    })
    harness.controller.dispose()
  })
})

describe("retained analytics run", () => {
  it("never treats a cached experiment as currently testing or mixes journal runs", () => {
    const snapshot = experimentSnapshot()
    const retained = analyticsSelection.analyticsRun({
      ...INITIAL_VIEW,
      snapshot: idle(),
      lastRunSnapshot: snapshot,
      lastRunJournal: { ...INITIAL_VIEW.journal, runId: "another-run", entries: [entry(1)] },
    })
    expect(retained?.entries).toEqual([])
    expect(analyticsSelection.experimentView(snapshot, [], true)).toEqual({
      phase: "last",
      hypothesis: testingExperiment,
    })
  })

  it("keeps the accepted experiment when authoritative state becomes idle", async () => {
    const previous = experimentSnapshot(
      { status: "completed" },
      {
        hypotheses: [finishedExperiment],
        active_hypothesis_id: null,
      },
    )
    const harness = await boot(previous)
    await harness.scheduler.advance(500)
    await answerState(harness, idle())
    expect(harness.controller.getView().snapshot?.run_id).toBeNull()
    const retained = analyticsSelection.analyticsRun(harness.controller.getView())
    expect(retained?.snapshot).toEqual(previous)
    expect(retained?.retained).toBe(true)
    const rejected = harness.controller.startRun(7)
    lastOf(harness.gateway.startCalls).deferred.reject(
      new ApiError(503, "unavailable", "offline", true),
    )
    await rejected
    expect(analyticsSelection.analyticsRun(harness.controller.getView())?.snapshot).toEqual(
      previous,
    )
    const accepted = harness.controller.startRun(8)
    lastOf(harness.gateway.startCalls).deferred.resolve(
      experimentSnapshot(
        {
          run_id: "next-run",
          generation: 4,
          revision: 1,
          status: "starting",
        },
        { hypotheses: [], active_hypothesis_id: null },
      ),
    )
    await accepted
    const current = analyticsSelection.analyticsRun(harness.controller.getView())
    expect(current?.snapshot.run_id).toBe("next-run")
    expect(current?.retained).toBe(false)
    expect(current?.entries).toEqual([])
    harness.controller.dispose()
  })
})
