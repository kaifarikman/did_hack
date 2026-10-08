import type {
  ErrorInfo,
  HypothesisView,
  JournalEntry,
  MissionPlanView,
} from "../../domain/contract"
import { parseJournalPage, parseSnapshot } from "../../domain/validation"
import stateIdleExample from "./examples/state-idle.json"

export type JournalContent = Omit<JournalEntry, "sequence">

const JOURNAL_DEFAULTS = {
  simulation_time_s: null,
  hypothesis_id: null,
  expected: null,
  observed: null,
  conclusion: null,
  experiment_id: null,
  detection_id: null,
  plan_id: null,
  evidence: [],
}

function snapshotWith(field: string, value: unknown) {
  return parseSnapshot({ ...structuredClone(stateIdleExample), [field]: value })
}

export function planFrom(raw: unknown): MissionPlanView {
  const plan = snapshotWith("plan", raw).plan
  if (plan === null) throw new Error("fixture plan content is empty")
  return plan
}

export function errorFrom(raw: unknown): ErrorInfo {
  const error = snapshotWith("last_error", raw).last_error
  if (error === null) throw new Error("fixture error content is empty")
  return error
}

export function hypothesesFrom(raw: unknown): HypothesisView[] {
  const research = snapshotWith("research", {
    sensor: { state: "ok", fault: null, quality: 1 },
    hazards: [],
    hypotheses: raw,
    last_replan_reason: null,
    last_replan_detection_id: null,
    planner_requests: 0,
  }).research
  return research?.hypotheses ?? []
}

export function journalFrom(raw: readonly object[]): JournalContent[] {
  const page = parseJournalPage({
    run_id: "fixture-content",
    entries: raw.map((item, index) => ({ ...JOURNAL_DEFAULTS, ...item, sequence: index + 1 })),
    next_sequence: raw.length,
    has_more: false,
  })
  return page.entries.map(({ sequence: _sequence, ...rest }) => rest)
}

export function journalEntryFrom(raw: object): JournalContent {
  const [entry] = journalFrom([raw])
  if (entry === undefined) throw new Error("fixture journal content is empty")
  return entry
}

export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === undefined ? match : String(value)
  })
}
