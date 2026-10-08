import { memo, useState } from "react"
import type { JournalEntry as Entry } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Button, Disclosure, type Verdict, VerdictMark } from "@/ui/shared/ui"
import { JournalNode } from "../journal-node"
import { CHAIN_LABELS, KIND_LABELS, VERDICT_LABELS } from "../labels"
import styles from "./styles.module.css"

export interface JournalEntryProps {
  readonly entry: Entry
  readonly fresh: boolean
  readonly verdict: Verdict | null
  readonly hypothesisNumber: number | null
  readonly onShowChain: (hypothesisId: string) => void
}

interface ChainRowProps {
  readonly label: string
  readonly value: string | null
}

function ChainRow({ label, value }: ChainRowProps) {
  if (value === null) return null
  return (
    <div className={styles.chain}>
      <dt>{label}</dt>
      <BackendText as="dd">{value}</BackendText>
    </div>
  )
}

function JournalEntryView({
  entry,
  fresh,
  verdict,
  hypothesisNumber,
  onShowChain,
}: JournalEntryProps) {
  const [arrived] = useState(fresh)
  const text = useMessageText()
  const format = useFormatters()
  const time =
    entry.simulation_time_s === null ? null : format.duration(entry.simulation_time_s)
  const kindLabel = text({ key: KIND_LABELS[entry.kind] })
  const verdictLabel = verdict === null ? null : text({ key: VERDICT_LABELS[verdict] })
  const summary = (
    <span className={styles.summary}>
      <BackendText className={styles.title}>{entry.title}</BackendText>
      {verdict !== null && verdictLabel !== null && (
        <VerdictMark verdict={verdict} label={verdictLabel} />
      )}
      <span className={styles.sequence}>
        {text({ key: "journal:sequence", params: { number: format.integer(entry.sequence) } })}
      </span>
    </span>
  )
  const hypothesisId = entry.hypothesis_id
  return (
    <li
      className={styles.entry}
      data-kind={entry.kind}
      data-verdict={verdict ?? undefined}
      data-fresh={arrived}
      data-motion="fade"
    >
      <span className={styles.time}>{time}</span>
      <JournalNode
        kind={entry.kind}
        verdict={verdict}
        label={verdictLabel === null ? kindLabel : `${kindLabel}: ${verdictLabel}`}
      />
      <Disclosure summary={summary} className={styles.disclosure}>
        <div className={styles.body}>
          {entry.detail !== "" && <BackendText as="p">{entry.detail}</BackendText>}
          <dl className={styles.chains}>
            <ChainRow label={text({ key: CHAIN_LABELS.expected })} value={entry.expected} />
            <ChainRow label={text({ key: CHAIN_LABELS.observed })} value={entry.observed} />
            <ChainRow label={text({ key: CHAIN_LABELS.conclusion })} value={entry.conclusion} />
          </dl>
          {hypothesisId !== null && (
            <Button
              variant="ghost"
              icon="hypothesis"
              className={styles.chainAction}
              onClick={() => onShowChain(hypothesisId)}
            >
              {text({
                key: "journal:showChain",
                params: { number: format.integer(hypothesisNumber ?? 0) },
              })}
            </Button>
          )}
        </div>
      </Disclosure>
    </li>
  )
}

export const JournalEntry = memo(JournalEntryView)
