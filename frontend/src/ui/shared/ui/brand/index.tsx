import { clsx } from "clsx"
import styles from "./styles.module.css"

const MARK_OUTER = "M8 26C8 14 18 7 28 9c10 2 14 11 12 20-2 9-12 13-21 11C11 38 8 33 8 26Z"
const MARK_INNER = "M15 25c0-7 6-11 12-9.5 6 1.5 8 6.5 6.5 12-1.5 5-7.5 7.5-12.5 6.3-4-1-6-4.3-6-8.8Z"

const WORD_PATHS = [
  "M14.5 5.5c-1.2 13-1.4 25.6-.4 35.6.5 4.6 2.6 6.6 6.4 6",
  "M29 35.6c-.6-8 5.2-13.4 12.2-12.8 7.4.6 11.6 6.2 10.9 12.9-.7 7.2-6.7 12-13.6 11.4C32.6 46.6 29.4 41.8 29 35.6Z",
  "M80.4 29.8c-2.6-6.2-10.6-8.6-15.6-4.4-5.6 4.7-5.2 15-.2 19.6 5.2 4.6 12.6 1.8 15.6-4.8M80.8 22.6c-.6 8.2-.5 16.8 1 24.6",
  "M91.6 47.2c.5-6.4.2-13.8-.4-20.4m.4 4.2c.6-5.2 3.4-8.4 7.4-8.2 4.6.2 6.8 3.6 6.6 8.8-.2 5 .2 10.4.6 15.4m-.6-15c1-5.2 4-8.4 8-8.1 4.6.3 6.6 3.6 6.4 9-.2 4.8.2 9.4.8 14",
]

export interface BrandMarkProps {
  readonly className?: string | undefined
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg className={clsx(styles.mark, className)} viewBox="0 0 48 48" aria-hidden="true">
      <path className={styles.line} d={MARK_OUTER} />
      <path className={styles.line} d={MARK_INNER} />
      <circle className={styles.dot} cx="24.6" cy="24.6" r="3.6" />
    </svg>
  )
}

export interface BrandLockupProps {
  readonly label: string
  readonly className?: string | undefined
}

export function BrandLockup({ label, className }: BrandLockupProps) {
  return (
    <span className={clsx(styles.lockup, className)} role="img" aria-label={label}>
      <BrandMark />
      <svg className={styles.word} viewBox="0 0 130 56" aria-hidden="true">
        {WORD_PATHS.map((path) => (
          <path key={path} className={styles.letter} d={path} />
        ))}
      </svg>
    </span>
  )
}
