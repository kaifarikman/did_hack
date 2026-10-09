import type { ReactNode } from "react"
import { BrandLockup } from "@/ui/shared/ui"
import styles from "./styles.module.css"

export interface AppHeaderProps {
  readonly brand: string
  readonly demo?: ReactNode
  readonly locale?: ReactNode
  readonly navigation?: ReactNode
  readonly action?: ReactNode
}

export function AppHeader({ brand, demo, locale, navigation, action }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.identity}>
        <BrandLockup label={brand} className={styles.brand} />
      </h1>
      {navigation !== undefined && <div className={styles.navigation}>{navigation}</div>}
      <div className={styles.controls}>
        {action}
        {demo}
        {locale}
      </div>
    </header>
  )
}
