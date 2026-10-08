import { useEffect, useMemo, useState } from "react"
import type { JournalEntry as Entry } from "@/domain/contract"
import { groupRepeatedEntries, listHypothesisIds } from "@/domain/journal"
import { useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Button, EmptyState, type Verdict } from "@/ui/shared/ui"
import { JournalEntry } from "../journal-entry"
import { JournalGroup } from "../journal-group"
import { visibleWindow } from "../paging"
import styles from "./styles.module.css"

export interface JournalListProps {
  readonly runId: string | null
  readonly entries: readonly Entry[]
  readonly matching: readonly Entry[]
  readonly verdicts: ReadonlyMap<string, Verdict>
  readonly limit: number
  readonly onMore: () => void
  readonly onShowChain: (hypothesisId: string) => void
}

interface Baseline {
  readonly runId: string | null
  readonly sequence: number
}

function useFreshBaseline(runId: string | null, lastSequence: number): number {
  const [baseline, setBaseline] = useState<Baseline>({ runId, sequence: lastSequence })
  if (baseline.runId !== runId) setBaseline({ runId, sequence: lastSequence })
  useEffect(() => {
    setBaseline((current) =>
      current.runId === runId && current.sequence < lastSequence
        ? { ...current, sequence: lastSequence }
        : current,
    )
  }, [runId, lastSequence])
  return baseline.sequence
}

function entryVerdict(entry: Entry, verdicts: ReadonlyMap<string, Verdict>): Verdict | null {
  if (entry.kind !== "outcome" || entry.hypothesis_id === null) return null
  return verdicts.get(entry.hypothesis_id) ?? null
}

export function JournalList({
  runId,
  entries,
  matching,
  verdicts,
  limit,
  onMore,
  onShowChain,
}: JournalListProps) {
  const text = useMessageText()
  const format = useFormatters()
  const lastSequence = entries[entries.length - 1]?.sequence ?? 0
  const baseline = useFreshBaseline(runId, lastSequence)
  const hypothesisNumbers = useMemo(
    () => new Map(listHypothesisIds(entries).map((id, index) => [id, index + 1])),
    [entries],
  )
  const shown = visibleWindow(matching, limit)
  const runs = groupRepeatedEntries(shown.entries)

  const renderEntry = (entry: Entry) => (
    <JournalEntry
      key={entry.sequence}
      entry={entry}
      fresh={entry.sequence > baseline}
      verdict={entryVerdict(entry, verdicts)}
      hypothesisNumber={
        entry.hypothesis_id === null
          ? null
          : (hypothesisNumbers.get(entry.hypothesis_id) ?? null)
      }
      onShowChain={onShowChain}
    />
  )

  return (
    <section className={styles.scroll} aria-label={text({ key: "journal:listLabel" })}>
      {matching.length === 0 ? (
        <EmptyState icon="journal" title={text({ key: "journal:empty" })} />
      ) : (
        <div className={styles.list}>
          {shown.hidden > 0 && (
            <Button variant="ghost" icon="more" className={styles.more} onClick={onMore}>
              {text({
                key: "journal:loadMore",
                params: { count: format.integer(shown.hidden) },
              })}
            </Button>
          )}
          <ol className={styles.entries}>
            {runs.map((run) => {
              const [single] = run.entries
              if (run.entries.length === 1 && single !== undefined) return renderEntry(single)
              return (
                <JournalGroup
                  key={`group-${run.key}`}
                  entries={run.entries}
                  fresh={run.entries.some((entry) => entry.sequence > baseline)}
                >
                  {run.entries.map(renderEntry)}
                </JournalGroup>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
