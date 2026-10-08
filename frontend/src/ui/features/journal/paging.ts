export const JOURNAL_PAGE_SIZE = 40

interface JournalWindow<T> {
  readonly entries: readonly T[]
  readonly hidden: number
}

export function visibleWindow<T>(entries: readonly T[], limit: number): JournalWindow<T> {
  const hidden = Math.max(entries.length - Math.max(limit, 0), 0)
  return { entries: entries.slice(hidden), hidden }
}
