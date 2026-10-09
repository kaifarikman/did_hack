import type { HypothesisView, JournalEntry, MissionSnapshot } from "../domain/contract"
import type { RunAnalytics } from "../domain/runAnalytics"
import { isActiveStatus } from "../domain/status"
import type { MissionViewState } from "./viewState"

export interface AnalyticsRun {
  readonly snapshot: MissionSnapshot
  readonly entries: readonly JournalEntry[]
  readonly retained: boolean
}

export function analyticsRun(view: MissionViewState): AnalyticsRun | null {
  const current = view.snapshot
  const retained = current === null || !hasRunContext(current)
  const snapshot = retained ? view.lastRunSnapshot : current
  if (snapshot == null || !hasRunContext(snapshot)) return null
  const journal = retained ? view.lastRunJournal : view.journal
  return {
    snapshot,
    entries: journal?.runId === snapshot.run_id ? journal.entries : [],
    retained,
  }
}

export function runAnalytics(snapshot: MissionSnapshot): RunAnalytics | null {
  const analytics = snapshot.analytics
  if (analytics == null) return null
  const summary = analytics.summary
  if (
    summary.run_id !== snapshot.run_id ||
    summary.robot_id !== snapshot.robot_id ||
    summary.generation !== snapshot.generation
  )
    return null
  return analytics
}

export function activeHypothesis(snapshot: MissionSnapshot): HypothesisView | null {
  if (!hasRunContext(snapshot) || !isActiveStatus(snapshot.status)) return null
  const research = snapshot.research
  if (research?.active_hypothesis_id == null) return null
  return (
    research.hypotheses.find(
      (hypothesis) =>
        hypothesis.hypothesis_id === research.active_hypothesis_id &&
        hypothesis.status === "testing",
    ) ?? null
  )
}

export interface ExperimentView {
  readonly phase: "active" | "last" | "waiting" | "idle"
  readonly hypothesis: HypothesisView | null
}

export function hasRunContext(snapshot: MissionSnapshot): boolean {
  return snapshot.run_id !== null
}

export function experimentView(
  snapshot: MissionSnapshot,
  entries: readonly JournalEntry[] = [],
  historical = false,
): ExperimentView {
  if (!hasRunContext(snapshot)) return { phase: "idle", hypothesis: null }
  const active = historical ? null : activeHypothesis(snapshot)
  if (active !== null) return { phase: "active", hypothesis: active }
  const experiments = (snapshot.research?.hypotheses ?? []).filter(
    (hypothesis) => hypothesis.experiment_id !== null,
  )
  let hypothesis = experiments.at(-1) ?? null
  let latestSequence = -1
  for (const entry of entries) {
    if (entry.kind !== "experiment" || entry.sequence <= latestSequence) continue
    const candidate = experiments.find(
      (experiment) =>
        experiment.hypothesis_id === entry.hypothesis_id &&
        experiment.experiment_id === entry.experiment_id,
    )
    if (candidate === undefined) continue
    hypothesis = candidate
    latestSequence = entry.sequence
  }
  return hypothesis === null
    ? { phase: "waiting", hypothesis: null }
    : { phase: "last", hypothesis }
}

export function hypothesisEvidence(
  hypothesis: HypothesisView,
  entries: readonly JournalEntry[],
): JournalEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.hypothesis_id === hypothesis.hypothesis_id &&
        (entry.experiment_id === null || entry.experiment_id === hypothesis.experiment_id),
    )
    .slice(-4)
}
