import type { JournalKind } from "@/domain/contract"
import { Icon, type IconName, Tooltip, type Verdict } from "@/ui/shared/ui"
import styles from "./styles.module.css"

export interface JournalNodeProps {
  readonly kind: JournalKind
  readonly verdict: Verdict | null
  readonly label: string
  readonly stacked?: boolean | undefined
}

const KIND_ICONS: Readonly<Record<JournalKind, IconName>> = {
  observation: "observation",
  hypothesis: "hypothesis",
  experiment: "experiment",
  decision: "decision",
  outcome: "confirmed",
  error: "critical",
}

const VERDICT_ICONS: Readonly<Record<Verdict, IconName>> = {
  confirmed: "confirmed",
  refuted: "refuted",
  inconclusive: "inconclusive",
}

export function JournalNode({ kind, verdict, label, stacked = false }: JournalNodeProps) {
  const icon = verdict === null ? KIND_ICONS[kind] : VERDICT_ICONS[verdict]
  return (
    <span className={styles.rail}>
      <Tooltip content={label}>
        <span
          className={styles.node}
          data-node-kind={kind}
          data-verdict={verdict ?? undefined}
          data-stacked={stacked}
        >
          <Icon name={icon} size="sm" label={label} />
        </span>
      </Tooltip>
    </span>
  )
}
