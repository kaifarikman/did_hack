import { useEffect, useMemo, useState } from "react"
import type { JournalEntry as Entry } from "@/domain/contract"
import { listHypothesisIds } from "@/domain/journal"
import { useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Button, EmptyState, ScrollArea } from "@/ui/shared/ui"
import { JournalEntry } from "../journal-entry"
import { visibleWindow } from "../paging"
import styles from "./styles.module.css"

export interface JournalListProps {
  readonly runId: string | null
  readonly entries: readonly Entry[]
  readonly matching: readonly Entry[]
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

export function JournalList({
  runId,
  entries,
  matching,
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

  return (
    <ScrollArea className={styles.scroll} label={text({ key: "journal:listLabel" })}>
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
            {shown.entries.map((entry) => (
              <JournalEntry
                key={entry.sequence}
                entry={entry}
                fresh={entry.sequence > baseline}
                hypothesisNumber={
                  entry.hypothesis_id === null
                    ? null
                    : (hypothesisNumbers.get(entry.hypothesis_id) ?? null)
                }
                onShowChain={onShowChain}
              />
            ))}
          </ol>
        </div>
      )}
    </ScrollArea>
  )
}
