import type { JournalEntry, JournalKind } from "./contract"

export function mergeJournalEntries(
  existing: readonly JournalEntry[],
  incoming: readonly JournalEntry[],
): JournalEntry[] {
  const bySequence = new Map<number, JournalEntry>()
  for (const entry of existing) bySequence.set(entry.sequence, entry)
  for (const entry of incoming) {
    if (!bySequence.has(entry.sequence)) bySequence.set(entry.sequence, entry)
  }
  return [...bySequence.values()].sort((first, second) => first.sequence - second.sequence)
}

export function filterJournal(
  entries: readonly JournalEntry[],
  kind: JournalKind | "all",
): JournalEntry[] {
  return kind === "all" ? [...entries] : entries.filter((entry) => entry.kind === kind)
}

export function listHypothesisIds(entries: readonly JournalEntry[]): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.hypothesis_id !== null && !ids.includes(entry.hypothesis_id))
      ids.push(entry.hypothesis_id)
  }
  return ids
}

export interface JournalExport {
  run_id: string
  last_sequence: number
  entry_count: number
  entries: JournalEntry[]
}

export function buildJournalExport(
  runId: string,
  entries: readonly JournalEntry[],
  lastSequence: number,
): JournalExport {
  const ordered = mergeJournalEntries([], entries)
  return {
    run_id: runId,
    last_sequence: lastSequence,
    entry_count: ordered.length,
    entries: ordered,
  }
}
