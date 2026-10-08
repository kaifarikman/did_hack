import { type ReactNode, useRef } from "react"
import { LayerHost, ScrollArea } from "@/ui/shared/ui"
import type { ViewMode } from "../viewMode"
import { useGridColumns } from "./gridColumns"
import styles from "./styles.module.css"

export interface AppLayoutProps {
  readonly header: ReactNode
  readonly notice?: ReactNode
  readonly map: ReactNode
  readonly mission: ReactNode
  readonly primary: ReactNode
  readonly secondary: ReactNode
  readonly view?: ViewMode
  readonly restLabel: string
  readonly extraLabel: string
}

export function AppLayout({
  header,
  notice,
  map,
  mission,
  primary,
  secondary,
  view = "default",
  restLabel,
  extraLabel,
}: AppLayoutProps) {
  const sideRef = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(sideRef)
  const split = columns > 1
  return (
    <main className={styles.shell} data-view={view}>
      <LayerHost>
        <div className={styles.header}>{header}</div>
        <div className={styles.main}>
          <div className={styles.map}>
            {map}
            <div className={styles.notice}>{notice}</div>
          </div>
          <div ref={sideRef} className={styles.side} data-columns={columns}>
            <ScrollArea className={styles.rest} surface="canvas" label={restLabel}>
              <div className={styles.stack}>
                {mission}
                {primary}
                {!split && secondary}
              </div>
            </ScrollArea>
            {split && (
              <ScrollArea className={styles.extra} surface="canvas" label={extraLabel}>
                <div className={styles.stack}>{secondary}</div>
              </ScrollArea>
            )}
          </div>
        </div>
      </LayerHost>
    </main>
  )
}
