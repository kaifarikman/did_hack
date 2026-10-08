import { memo, useState } from "react"
import type { JournalEntry as Entry } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Button, Disclosure, Icon, type IconName } from "@/ui/shared/ui"
import { CHAIN_LABELS, KIND_LABELS } from "../labels"
import styles from "./styles.module.css"

export interface JournalEntryProps {
  readonly entry: Entry
  readonly fresh: boolean
  readonly hypothesisNumber: number | null
  readonly onShowChain: (hypothesisId: string) => void
}

interface ChainRowProps {
  readonly label: string
  readonly value: string | null
}

const KIND_ICONS: Readonly<Record<Entry["kind"], IconName>> = {
  observation: "observation",
  hypothesis: "hypothesis",
  experiment: "experiment",
  decision: "decision",
  outcome: "confirmed",
  error: "critical",
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

function JournalEntryView({ entry, fresh, hypothesisNumber, onShowChain }: JournalEntryProps) {
  const [arrived] = useState(fresh)
  const text = useMessageText()
  const format = useFormatters()
  const time =
    entry.simulation_time_s === null ? null : format.duration(entry.simulation_time_s)
  const summary = (
    <span className={styles.summary}>
      <Icon name={KIND_ICONS[entry.kind]} />
      <span className={styles.meta}>
        <span>
          {text({
            key: "journal:sequence",
            params: { number: format.integer(entry.sequence) },
          })}
        </span>
        {time !== null && <span>{time}</span>}
      </span>
      <span className={styles.kind}>{text({ key: KIND_LABELS[entry.kind] })}</span>
      <BackendText className={styles.title}>{entry.title}</BackendText>
    </span>
  )
  const hypothesisId = entry.hypothesis_id
  return (
    <li className={styles.entry} data-kind={entry.kind} data-fresh={arrived} data-motion="fade">
      <Disclosure summary={summary}>
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
