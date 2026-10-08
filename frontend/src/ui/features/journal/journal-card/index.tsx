import { useCallback, useMemo, useState } from "react"
import type { MissionController } from "@/application/missionController"
import type { MissionViewState } from "@/application/viewState"
import { filterJournal, type JournalExport } from "@/domain/journal"
import { messageDetail } from "@/domain/message"
import { BackendText, useMessageText } from "@/ui/shared/i18n"
import { useLoadingIndicator } from "@/ui/shared/motion"
import { Button, Card, ErrorState, Select, Skeleton } from "@/ui/shared/ui"
import { JournalExportNotices } from "../journal-export"
import { JournalList } from "../journal-list"
import {
  EXPORT_PHASE_LABELS,
  FILTER_ALL_LABEL,
  JOURNAL_KINDS,
  KIND_LABELS,
  type KindFilter,
} from "../labels"
import { JOURNAL_PAGE_SIZE } from "../paging"
import styles from "./styles.module.css"

export interface JournalCardProps {
  readonly view: MissionViewState
  readonly controller: MissionController
  readonly onExported: (result: JournalExport) => void
  readonly motionIndex: number
}

export function JournalCard({ view, controller, onExported, motionIndex }: JournalCardProps) {
  const text = useMessageText()
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
  const showChain = useCallback((id: string) => controller.selectHypothesis(id), [controller])
  const showMore = useCallback(() => setLimit((current) => current + JOURNAL_PAGE_SIZE), [])
  const errorDetail = messageDetail(journal.error)
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
      <JournalExportNotices
        exportState={exportState}
        exportedCount={exported}
        onDismissDone={() => setExported(null)}
      />
      {selectedHypothesisId !== null && (
        <Button variant="ghost" icon="close" onClick={() => controller.selectHypothesis(null)}>
          {text({ key: "journal:hideChain" })}
        </Button>
      )}
      {journal.error !== null && (
        <ErrorState
          title={text(journal.error)}
          description={
            errorDetail === null ? undefined : <BackendText>{errorDetail}</BackendText>
          }
        />
      )}
      {loading === "skeleton" ? (
        <Skeleton lines={4} />
      ) : (
        <JournalList
          runId={journal.runId}
          entries={journal.entries}
          matching={matching}
          limit={limit}
          onMore={showMore}
          onShowChain={showChain}
        />
      )}
    </Card>
  )
}
