import type { ReactNode } from "react"
import type { ConnectionStatus } from "@/application/viewState"
import { type IconName, StatusBadge, type StatusTone } from "@/ui/shared/ui"
import styles from "./styles.module.css"

type HeaderConnection = ConnectionStatus

export interface AppHeaderProps {
  readonly title: string
  readonly connection: HeaderConnection
  readonly connectionLabel: string
  readonly demo?: ReactNode
  readonly locale?: ReactNode
}

const CONNECTION_TONES: Readonly<Record<HeaderConnection, StatusTone>> = {
  connecting: "progress",
  live: "positive",
  stale: "attention",
  offline: "critical",
}

const CONNECTION_ICONS: Readonly<Record<HeaderConnection, IconName>> = {
  connecting: "loader",
  live: "live",
  stale: "alert",
  offline: "offline",
}

export function AppHeader({
  title,
  connection,
  connectionLabel,
  demo,
  locale,
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.controls}>
        {demo}
        {locale}
        <div className={styles.slot} role="status">
          <StatusBadge
            tone={CONNECTION_TONES[connection]}
            icon={CONNECTION_ICONS[connection]}
            live={connection === "live"}
            swapKey={connection}
          >
            {connectionLabel}
          </StatusBadge>
        </div>
      </div>
    </header>
  )
}
