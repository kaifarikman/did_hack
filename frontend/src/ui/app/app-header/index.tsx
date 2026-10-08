import type { ReactNode } from "react"
import { BrandLockup } from "@/ui/shared/ui"
import styles from "./styles.module.css"

export interface AppHeaderProps {
  readonly brand: string
  readonly demo?: ReactNode
  readonly locale?: ReactNode
}

export function AppHeader({ brand, demo, locale }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.identity}>
        <BrandLockup label={brand} className={styles.brand} />
      </h1>
      <div className={styles.controls}>
        {demo}
        {locale}
      </div>
    </header>
  )
}
