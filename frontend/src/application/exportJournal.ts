import type { JournalEntry } from "../domain/contract";
import { buildJournalExport, type JournalExport } from "../domain/journal";
import type { MissionGateway } from "./ports";

export const EXPORT_PAGE_SIZE = 200;

export class ExportCancelledError extends Error {
  constructor(message = "Выгрузка отменена") {
    super(message);
    this.name = "ExportCancelledError";
  }
}

export class ExportFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailedError";
  }
}

export interface ExportOptions {
  signal?: AbortSignal;
  isCancelled: () => boolean;
}

/**
 * Читает журнал прогона с начала до первой страницы с has_more: false.
 * Не атомарный снимок: next_sequence последней страницы становится верхней границей выгрузки.
 */
export async function exportFullJournal(
  gateway: MissionGateway,
  runId: string,
  options: ExportOptions,
): Promise<JournalExport> {
  const entries: JournalEntry[] = [];
  const seenSequences = new Set<number>();
  let cursor = 0;
  for (;;) {
    if (options.isCancelled()) throw new ExportCancelledError("Выгрузка отменена: сменился прогон");
    const page = await gateway.getJournalPage(runId, cursor, EXPORT_PAGE_SIZE, { signal: options.signal });
    if (options.isCancelled()) throw new ExportCancelledError("Выгрузка отменена: сменился прогон");
    if (page.run_id !== runId) {
      throw new ExportFailedError("Backend вернул журнал другого прогона; файл не создан");
    }
    for (const entry of page.entries) {
      if (!seenSequences.has(entry.sequence)) {
        seenSequences.add(entry.sequence);
        entries.push(entry);
      }
    }
    if (!page.has_more) return buildJournalExport(runId, entries, page.next_sequence);
    if (page.next_sequence <= cursor) {
      throw new ExportFailedError("Backend не продвинул курсор журнала; файл не создан");
    }
    cursor = page.next_sequence;
  }
}
