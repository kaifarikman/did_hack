import { clsx } from "clsx"
import styles from "./styles.module.css"

export type SkeletonShape = "line" | "block" | "circle"

export interface SkeletonProps {
  readonly shape?: SkeletonShape | undefined
  readonly lines?: number | undefined
  readonly className?: string | undefined
}

const SHAPE_CLASS: Readonly<Record<SkeletonShape, string | undefined>> = {
  line: styles.line,
  block: styles.block,
  circle: styles.circle,
}

export function Skeleton({ shape = "line", lines = 1, className }: SkeletonProps) {
  const count = shape === "line" ? Math.max(1, Math.trunc(lines)) : 1
  return (
    <span className={clsx(styles.group, className)} aria-hidden="true" data-skeleton={shape}>
      {Array.from({ length: count }, (_, index) => `bone-${index}`).map((bone) => (
        <span key={bone} className={clsx(styles.bone, SHAPE_CLASS[shape])} />
      ))}
    </span>
  )
}
