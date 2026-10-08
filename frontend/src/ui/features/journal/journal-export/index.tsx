import type { ExportState } from "@/application/viewState"
import { messageDetail } from "@/domain/message"
import { BackendText, useMessageText } from "@/ui/shared/i18n"
import { Banner } from "@/ui/shared/ui"
import { EXPORT_PHASE_LABELS } from "../labels"

export interface JournalExportNoticesProps {
  readonly exportState: ExportState
  readonly exportedCount: number | null
  readonly onDismissDone: () => void
}

export function JournalExportNotices({
  exportState,
  exportedCount,
  onDismissDone,
}: JournalExportNoticesProps) {
  const text = useMessageText()
  const { phase, cause } = exportState
  const detail = messageDetail(cause)

  return (
    <>
      <Banner
        open={phase === "failed" || phase === "cancelled"}
        tone={phase === "failed" ? "critical" : "attention"}
        title={text({ key: EXPORT_PHASE_LABELS[phase] })}
      >
        {cause === null ? null : <p>{text(cause)}</p>}
        {detail === null ? null : <BackendText as="p">{detail}</BackendText>}
      </Banner>
      <Banner
        open={exportedCount !== null && phase === "idle"}
        tone="info"
        icon="confirmed"
        title={text({ key: "journal:export.done" })}
        onDismiss={onDismissDone}
      >
        {text({ key: "journal:entries", params: { count: exportedCount ?? 0 } })}
      </Banner>
    </>
  )
}
