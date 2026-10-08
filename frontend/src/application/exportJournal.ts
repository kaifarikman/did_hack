import type { JournalEntry } from "../domain/contract"
import { buildJournalExport, type JournalExport } from "../domain/journal"
import { LocalizedError, type Message, msg } from "../domain/message"
import type { MissionGateway } from "./ports"

export const EXPORT_PAGE_SIZE = 200

export class ExportCancelledError extends LocalizedError {
  constructor(descriptor: Message = msg("errors:export.cancelled")) {
    super(descriptor)
    this.name = "ExportCancelledError"
  }
}

export class ExportFailedError extends LocalizedError {
  constructor(descriptor: Message) {
    super(descriptor)
    this.name = "ExportFailedError"
  }
}

export interface ExportOptions {
  signal?: AbortSignal | undefined
  isCancelled: () => boolean
}

export async function exportFullJournal(
  gateway: MissionGateway,
  runId: string,
  options: ExportOptions,
): Promise<JournalExport> {
  const entries: JournalEntry[] = []
  const seenSequences = new Set<number>()
  let cursor = 0
  for (;;) {
    ensureNotCancelled(options)
    const page = await gateway.getJournalPage(runId, cursor, EXPORT_PAGE_SIZE, {
      signal: options.signal,
    })
    ensureNotCancelled(options)
    if (page.run_id !== runId) {
      throw new ExportFailedError(msg("errors:export.otherRun"))
    }
    appendUnseen(entries, seenSequences, page.entries)
    if (!page.has_more) return buildJournalExport(runId, entries, page.next_sequence)
    if (page.next_sequence <= cursor) {
      throw new ExportFailedError(msg("errors:export.cursorStuck"))
    }
    cursor = page.next_sequence
  }
}

function ensureNotCancelled(options: ExportOptions): void {
  if (options.isCancelled()) throw new ExportCancelledError()
}

function appendUnseen(
  entries: JournalEntry[],
  seenSequences: Set<number>,
  pageEntries: readonly JournalEntry[],
): void {
  for (const entry of pageEntries) {
    if (seenSequences.has(entry.sequence)) continue
    seenSequences.add(entry.sequence)
    entries.push(entry)
  }
}
