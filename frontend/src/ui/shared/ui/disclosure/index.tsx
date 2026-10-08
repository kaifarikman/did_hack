import { clsx } from "clsx"
import type { ReactNode } from "react"
import { useDetailsMotion } from "../../motion"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export interface DisclosureProps {
  readonly summary: ReactNode
  readonly defaultOpen?: boolean | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}

export function Disclosure({
  summary,
  defaultOpen = false,
  className,
  children,
}: DisclosureProps) {
  const motion = useDetailsMotion(defaultOpen)
  return (
    <details
      ref={motion.detailsRef}
      className={clsx(styles.disclosure, className)}
      data-state={motion.state}
      data-instant={motion.instant}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is natively interactive */}
      <summary className={styles.summary} onClick={motion.onSummaryClick}>
        <Icon name="chevron-right" size="sm" className={styles.chevron} />
        <span className={styles.label}>{summary}</span>
      </summary>
      <div ref={motion.contentRef} className={styles.content} data-motion="fade">
        {children}
      </div>
    </details>
  )
}
