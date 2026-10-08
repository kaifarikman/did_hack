import { type CSSProperties, useMemo } from "react"
import { useMessageText } from "@/ui/shared/i18n"
import { Tooltip } from "@/ui/shared/ui"
import type { LegendItem, LegendShape } from "../labels"
import { readMapPalette } from "../mapTheme"
import styles from "./styles.module.css"

export interface MapLegendProps {
  readonly items: readonly LegendItem[]
}

const SHAPE_CLASS: Readonly<Record<LegendShape, string | undefined>> = {
  marker: styles.marker,
  cell: styles.cell,
  line: styles.line,
  dashed: styles.dashed,
  ring: styles.ring,
}

export function MapLegend({ items }: MapLegendProps) {
  const text = useMessageText()
  const palette = useMemo(() => readMapPalette(), [])
  if (items.length === 0) return null
  return (
    <ul className={styles.legend} aria-label={text({ key: "map:legend.title" })}>
      {items.map((item) => (
        <li key={item.label} className={styles.item} data-role={item.role}>
          <span
            className={SHAPE_CLASS[item.shape]}
            style={{ "--swatch": palette.css[item.role] } as CSSProperties}
            aria-hidden="true"
          />
          {item.note === undefined ? (
            text({ key: item.label })
          ) : (
            <Tooltip content={text({ key: item.note })}>
              <span className={styles.noted}>
                {text({ key: item.label })}
                <span className="visually-hidden">{text({ key: item.note })}</span>
              </span>
            </Tooltip>
          )}
        </li>
      ))}
    </ul>
  )
}
