import type { HypothesisView, MissionSnapshot, ResearchView } from "@/domain/contract"
import { snapshotWith } from "./support"

export const finishedExperiment: HypothesisView = {
  hypothesis_id: "signal-1",
  kind: "sample_signal",
  status: "confirmed",
  center: { position_x_m: 1, position_y_m: 2 },
  prediction: "Signal predicted within [0.5, 0.7]",
  measurement: "Independent median 0.62 from three messages",
  detection_id: null,
  experiment_id: "experiment-signal-1",
  expected_signal: 0.6,
  measured_signal: 0.62,
  baseline_signal: 0.3,
  measurement_count: 3,
  action: "Approach target at (1, 2)",
  conclusion: "Prediction confirmed by independent messages",
}

export const testingExperiment: HypothesisView = {
  ...finishedExperiment,
  hypothesis_id: "signal-2",
  experiment_id: "experiment-signal-2",
  status: "testing",
  prediction: "New signal forecast before movement",
  measurement: null,
  conclusion: null,
  measured_signal: null,
  measurement_count: 0,
}

export function experimentSnapshot(
  patch: Partial<MissionSnapshot> = {},
  researchPatch: Partial<ResearchView> = {},
): MissionSnapshot {
  return snapshotWith({
    run_id: "experiment-run",
    generation: 3,
    analytics: null,
    research: {
      sensor: { state: "ok", fault: null, quality: 1 },
      hazards: [],
      hypotheses: [finishedExperiment, testingExperiment],
      active_hypothesis_id: testingExperiment.hypothesis_id,
      last_replan_reason: null,
      last_replan_detection_id: null,
      planner_requests: 1,
      ...researchPatch,
    },
    ...patch,
  })
}
