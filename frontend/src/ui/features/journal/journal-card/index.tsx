import { useCallback, useEffect, useMemo, useState } from "react"
import type { MissionController } from "@/application/missionController"
import type { MissionViewState } from "@/application/viewState"
import { filterJournal, type JournalExport, listHypothesisIds } from "@/domain/journal"
import { messageDetail } from "@/domain/message"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { useLoadingIndicator } from "@/ui/shared/motion"
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ScrollArea,
  Select,
  Skeleton,
} from "@/ui/shared/ui"
import { JournalEntry } from "../journal-entry"
import {
  EXPORT_PHASE_LABELS,
  FILTER_ALL_LABEL,
  JOURNAL_KINDS,
  KIND_LABELS,
  type KindFilter,
} from "../labels"
import { JOURNAL_PAGE_SIZE, visibleWindow } from "../paging"
import styles from "./styles.module.css"

export interface JournalCardProps {
  readonly view: MissionViewState
  readonly controller: MissionController
  readonly onExported: (result: JournalExport) => void
  readonly motionIndex: number
}

interface Baseline {
  readonly runId: string | null
  readonly sequence: number
}

export function JournalCard({ view, controller, onExported, motionIndex }: JournalCardProps) {
  const text = useMessageText()
  const format = useFormatters()
  const { journal, exportState, selectedHypothesisId } = view
  const [filter, setFilter] = useState<KindFilter>("all")
  const [limit, setLimit] = useState(JOURNAL_PAGE_SIZE)
  const [exported, setExported] = useState<number | null>(null)
  const loading = useLoadingIndicator({ pending: view.snapshot === null, hasData: false })
  const matching = useMemo(
    () =>
      filterJournal(journal.entries, filter).filter(
        (entry) =>
          selectedHypothesisId === null || entry.hypothesis_id === selectedHypothesisId,
      ),
    [journal.entries, filter, selectedHypothesisId],
  )
  const hypothesisNumbers = useMemo(
    () => new Map(listHypothesisIds(journal.entries).map((id, index) => [id, index + 1])),
    [journal.entries],
  )
  const shown = visibleWindow(matching, limit)
  const lastSequence = journal.entries[journal.entries.length - 1]?.sequence ?? 0
  const [baseline, setBaseline] = useState<Baseline>({
    runId: journal.runId,
    sequence: lastSequence,
  })
  if (baseline.runId !== journal.runId)
    setBaseline({ runId: journal.runId, sequence: lastSequence })
  useEffect(() => {
    setBaseline((current) =>
      current.runId === journal.runId && current.sequence < lastSequence
        ? { ...current, sequence: lastSequence }
        : current,
    )
  }, [journal.runId, lastSequence])
  const showChain = useCallback((id: string) => controller.selectHypothesis(id), [controller])
  const exportProblem = exportState.phase === "failed" || exportState.phase === "cancelled"
  const options = [
    { value: "all" as const, label: text({ key: FILTER_ALL_LABEL }) },
    ...JOURNAL_KINDS.map((kind) => ({ value: kind, label: text({ key: KIND_LABELS[kind] }) })),
  ]

  const handleExport = async (): Promise<void> => {
    setExported(null)
    const result = await controller.exportJournal()
    if (result === null) return
    onExported(result)
    setExported(result.entry_count)
  }

  return (
    <Card
      as="section"
      level="top"
      motionIndex={motionIndex}
      className={styles.card}
      title={text({ key: "journal:title" })}
      actions={
        <span className={styles.count}>
          {text({ key: "journal:entries", params: { count: journal.entries.length } })}
        </span>
      }
    >
      <div className={styles.toolbar}>
        <Select<KindFilter>
          label={text({ key: "journal:filter.label" })}
          value={filter}
          options={options}
          onChange={(next) => {
            setFilter(next)
            setLimit(JOURNAL_PAGE_SIZE)
          }}
        />
        <Button
          variant="ghost"
          icon="download"
          pending={exportState.phase === "exporting"}
          disabled={view.snapshot?.run_id == null}
          onClick={() => void handleExport()}
        >
          {text({
            key: EXPORT_PHASE_LABELS[exportState.phase === "exporting" ? "exporting" : "idle"],
          })}
        </Button>
      </div>
      <Banner
        open={exportProblem}
        tone={exportState.phase === "failed" ? "critical" : "attention"}
        title={text({ key: EXPORT_PHASE_LABELS[exportState.phase] })}
      >
        {exportState.cause === null ? null : <p>{text(exportState.cause)}</p>}
        {messageDetail(exportState.cause) === null ? null : (
          <BackendText as="p">{messageDetail(exportState.cause)}</BackendText>
        )}
      </Banner>
      <Banner
        open={exported !== null && exportState.phase === "idle"}
        tone="info"
        icon="confirmed"
        title={text({ key: "journal:export.done" })}
        onDismiss={() => setExported(null)}
      >
        {text({ key: "journal:entries", params: { count: exported ?? 0 } })}
      </Banner>
      {selectedHypothesisId !== null && (
        <Button variant="ghost" icon="close" onClick={() => controller.selectHypothesis(null)}>
          {text({ key: "journal:hideChain" })}
        </Button>
      )}
      {journal.error !== null && (
        <ErrorState
          title={text(journal.error)}
          description={messageDetail(journal.error) ?? undefined}
        />
      )}
      {loading === "skeleton" ? (
        <Skeleton lines={4} />
      ) : (
        <ScrollArea className={styles.scroll} label={text({ key: "journal:listLabel" })}>
          {matching.length === 0 ? (
            <EmptyState icon="journal" title={text({ key: "journal:empty" })} />
          ) : (
            <div className={styles.list}>
              {shown.hidden > 0 && (
                <Button
                  variant="ghost"
                  icon="more"
                  className={styles.more}
                  onClick={() => setLimit((current) => current + JOURNAL_PAGE_SIZE)}
                >
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
                    fresh={entry.sequence > baseline.sequence}
                    hypothesisNumber={
                      entry.hypothesis_id === null
                        ? null
                        : (hypothesisNumbers.get(entry.hypothesis_id) ?? null)
                    }
                    onShowChain={showChain}
                  />
                ))}
              </ol>
            </div>
          )}
        </ScrollArea>
      )}
    </Card>
  )
}
