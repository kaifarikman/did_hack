import type { ExportPhase } from "@/application/viewState"
import type { JournalKind } from "@/domain/contract"
import type { MessageKey } from "@/domain/message"

type JournalKey = Extract<MessageKey, `journal:${string}`>
export type KindFilter = JournalKind | "all"

export { JOURNAL_KINDS } from "@/domain/contract"

export const KIND_LABELS: Readonly<Record<JournalKind, JournalKey>> = {
  observation: "journal:kind.observation",
  hypothesis: "journal:kind.hypothesis",
  experiment: "journal:kind.experiment",
  decision: "journal:kind.decision",
  outcome: "journal:kind.outcome",
  error: "journal:kind.error",
}

export const EXPORT_PHASE_LABELS: Readonly<Record<ExportPhase, JournalKey>> = {
  idle: "journal:export.action",
  exporting: "journal:export.exporting",
  failed: "journal:export.failed",
  cancelled: "journal:export.cancelled",
}

export const CHAIN_LABELS = {
  expected: "journal:chain.expected",
  observed: "journal:chain.observed",
  conclusion: "journal:chain.conclusion",
} as const satisfies Record<string, JournalKey>

export const FILTER_ALL_LABEL: JournalKey = "journal:filter.all"

export const VERDICT_LABELS = {
  confirmed: "journal:verdict.confirmed",
  refuted: "journal:verdict.refuted",
  inconclusive: "journal:verdict.inconclusive",
} as const satisfies Record<string, JournalKey>
