import { clsx } from "clsx"
import type { ReactNode } from "react"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export interface EmptyStateProps {
  readonly title: string
  readonly description?: string | undefined
  readonly icon?: IconName | undefined
  readonly action?: ReactNode
  readonly size?: "regular" | "hero" | undefined
  readonly className?: string | undefined
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  size = "regular",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(styles.empty, size === "hero" && styles.hero, className)}
      data-motion="fade"
    >
      {icon === undefined ? null : <Icon name={icon} size="lg" className={styles.icon} />}
      <p className={styles.title}>{title}</p>
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
      {action === undefined ? null : <div className={styles.action}>{action}</div>}
    </div>
  )
}
