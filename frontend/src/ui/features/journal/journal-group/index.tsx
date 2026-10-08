import { type ReactNode, useState } from "react"
import type { JournalEntry as Entry } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Disclosure } from "@/ui/shared/ui"
import { JournalNode } from "../journal-node"
import { KIND_LABELS } from "../labels"
import styles from "./styles.module.css"

export interface JournalGroupProps {
  readonly entries: readonly Entry[]
  readonly fresh: boolean
  readonly children: ReactNode
}

export function JournalGroup({ entries, fresh, children }: JournalGroupProps) {
  const [arrived] = useState(fresh)
  const text = useMessageText()
  const format = useFormatters()
  const first = entries[0]
  const last = entries[entries.length - 1]
  if (first === undefined || last === undefined) return null
  const count = format.integer(entries.length)
  const time =
    first.simulation_time_s === null ? null : format.duration(first.simulation_time_s)
  const summary = (
    <span className={styles.summary}>
      <BackendText className={styles.title}>{first.title}</BackendText>
      <span className={styles.count}>
        {text({ key: "journal:group.count", params: { count } })}
      </span>
      <span className={styles.range}>
        {text({
          key: "journal:group.range",
          params: {
            first: format.integer(first.sequence),
            last: format.integer(last.sequence),
          },
        })}
      </span>
    </span>
  )
  return (
    <li
      className={styles.group}
      data-group={first.kind}
      data-arrived={arrived}
      data-motion="fade"
      aria-label={text({ key: "journal:group.label", params: { title: first.title, count } })}
    >
      <span className={styles.time}>{time}</span>
      <JournalNode
        kind={first.kind}
        verdict={null}
        label={text({ key: KIND_LABELS[first.kind] })}
        stacked
      />
      <Disclosure summary={summary} className={styles.disclosure}>
        <ol className={styles.members}>{children}</ol>
      </Disclosure>
    </li>
  )
}
