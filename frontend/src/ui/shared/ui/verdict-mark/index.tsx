import { clsx } from "clsx"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export type Verdict = "confirmed" | "refuted" | "inconclusive"

export interface VerdictMarkProps {
  readonly verdict: Verdict
  readonly label: string
  readonly className?: string | undefined
}

export const VERDICT_ICON: Readonly<Record<Verdict, IconName>> = {
  confirmed: "confirmed",
  refuted: "refuted",
  inconclusive: "inconclusive",
}

const VERDICT_CLASS: Readonly<Record<Verdict, string | undefined>> = {
  confirmed: styles.confirmed,
  refuted: styles.refuted,
  inconclusive: styles.inconclusive,
}

export function VerdictMark({ verdict, label, className }: VerdictMarkProps) {
  return (
    <span
      className={clsx(styles.mark, VERDICT_CLASS[verdict], className)}
      data-verdict={verdict}
      data-motion="fade"
    >
      <Icon name={VERDICT_ICON[verdict]} size="sm" />
      <span>{label}</span>
    </span>
  )
}
