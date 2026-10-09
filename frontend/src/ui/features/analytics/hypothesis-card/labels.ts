import type { ExperimentView } from "@/application/analytics"

export function experimentLabels(experiment: ExperimentView, stale: boolean) {
  const active = experiment.phase === "active"
  const outcome = experiment.hypothesis?.status
  const concluded = outcome === "confirmed" || outcome === "refuted" || outcome === "unverified"
  return {
    title:
      experiment.hypothesis === null
        ? ("experiment" as const)
        : active
          ? ("currentExperiment" as const)
          : ("lastExperiment" as const),
    status: concluded
      ? outcome
      : active && !stale
        ? ("testing" as const)
        : ("unknown" as const),
    note: active
      ? ("provisional" as const)
      : concluded
        ? ("lastExperimentDetail" as const)
        : ("interruptedExperiment" as const),
  } as const
}

export function hypothesisStatement(kind: string) {
  if (kind === "sample_signal") return "sampleSignal"
  if (kind === "terrain_change") return "changed"
  if (kind === "costly_terrain") return "costly"
  return "otherHypothesis"
}
