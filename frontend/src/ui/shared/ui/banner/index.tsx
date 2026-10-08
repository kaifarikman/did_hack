import { clsx } from "clsx"
import type { ReactNode } from "react"
import { usePresence } from "../../motion"
import { CloseButton } from "../close-button"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export type BannerTone = "info" | "attention" | "critical"

export interface BannerProps {
  readonly tone: BannerTone
  readonly title: string
  readonly children?: ReactNode
  readonly icon?: IconName
  readonly action?: ReactNode
  readonly open?: boolean
  readonly onDismiss?: () => void
  readonly className?: string | undefined
}

const BANNER_ICON: Readonly<Record<BannerTone, IconName>> = {
  info: "info",
  attention: "alert",
  critical: "critical",
}

const TONE_CLASS: Readonly<Record<BannerTone, string | undefined>> = {
  info: undefined,
  attention: styles.attention,
  critical: styles.critical,
}

export function Banner({
  tone,
  title,
  children,
  icon,
  action,
  open = true,
  onDismiss,
  className,
}: BannerProps) {
  const presence = usePresence(open)
  if (!presence.mounted) return null
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={clsx(styles.banner, TONE_CLASS[tone], className)}
      data-tone={tone}
      data-state={presence.state}
      data-motion="fade"
      onTransitionEnd={presence.onTransitionEnd}
    >
      <Icon name={icon ?? BANNER_ICON[tone]} size="md" className={styles.icon} />
      <div className={styles.content}>
        <div className={styles.body}>
          <p className={styles.title}>{title}</p>
          {children === undefined ? null : <div className={styles.description}>{children}</div>}
        </div>
        {action === undefined ? null : <div className={styles.action}>{action}</div>}
      </div>
      {onDismiss === undefined ? null : (
        <CloseButton onClick={onDismiss} tone={tone === "critical" ? "inverse" : "default"} />
      )}
    </div>
  )
}
