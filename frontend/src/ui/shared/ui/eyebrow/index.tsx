import { clsx } from "clsx"
import type { ReactNode } from "react"
import styles from "./styles.module.css"

export interface EyebrowProps {
  readonly as?: "p" | "span" | "h2" | "h3" | "div"
  readonly tone?: "default" | "inverse"
  readonly id?: string
  readonly className?: string | undefined
  readonly children: ReactNode
}

export function Eyebrow({
  as: Tag = "p",
  tone = "default",
  id,
  className,
  children,
}: EyebrowProps) {
  return (
    <Tag
      id={id}
      className={clsx(styles.eyebrow, tone === "inverse" && styles.inverse, className)}
    >
      {children}
    </Tag>
  )
}
