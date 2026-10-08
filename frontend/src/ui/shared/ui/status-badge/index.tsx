import { clsx } from "clsx"
import type { ReactNode } from "react"
import { Swap } from "../../motion"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export type StatusTone = "neutral" | "progress" | "positive" | "attention" | "critical"

export interface StatusBadgeProps {
  readonly tone: StatusTone
  readonly icon?: IconName
  readonly live?: boolean
  readonly swapKey?: string
  readonly className?: string | undefined
  readonly children: ReactNode
}

const TONE_ICON: Readonly<Record<StatusTone, IconName | null>> = {
  neutral: "pending",
  progress: null,
  positive: "check",
  attention: "alert",
  critical: "critical",
}

const EMPHASIS_TONES: ReadonlySet<StatusTone> = new Set(["attention", "critical"])

interface MarkerProps {
  readonly tone: StatusTone
  readonly icon: IconName | undefined
  readonly live: boolean
}

function Marker({ tone, icon, live }: MarkerProps) {
  const glyph = icon ?? TONE_ICON[tone]
  if (live || glyph === null)
    return <span className={styles.pulse} data-marker="pulse" aria-hidden="true" />
  return <Icon name={glyph} size="sm" className={clsx(glyph === "loader" && styles.waiting)} />
}

export function StatusBadge({
  tone,
  icon,
  live = false,
  swapKey,
  className,
  children,
}: StatusBadgeProps) {
  return (
    <span
      className={clsx(styles.badge, EMPHASIS_TONES.has(tone) && styles.emphasis, className)}
      data-tone={tone}
    >
      <Marker tone={tone} icon={icon} live={live} />
      {swapKey === undefined ? children : <Swap swapKey={swapKey}>{children}</Swap>}
    </span>
  )
}
