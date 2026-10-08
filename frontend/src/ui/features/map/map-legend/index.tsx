import { useCallback, useId, useMemo, useRef, useState } from "react"
import { useMessageText } from "@/ui/shared/i18n"
import { Button, Popover, Tooltip } from "@/ui/shared/ui"
import type { LegendItem } from "../labels"
import { readMapPalette } from "../mapTheme"
import styles from "./styles.module.css"
import { LegendSwatch } from "./swatch"

export interface MapLegendProps {
  readonly items: readonly LegendItem[]
}

export function MapLegend({ items }: MapLegendProps) {
  const text = useMessageText()
  const palette = useMemo(() => readMapPalette(), [])
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  if (items.length === 0) return null
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="compact"
        icon="info"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {text({ key: "map:legend.open" })}
      </Button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-end"
        id={listId}
      >
        <ul className={styles.legend} aria-label={text({ key: "map:legend.title" })}>
          {items.map((item) => (
            <li key={item.label} className={styles.item} data-role={item.role}>
              <LegendSwatch
                className={styles.swatch}
                canvasClassName={styles.glyph}
                shape={item.shape}
                role={item.role}
                palette={palette}
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
      </Popover>
    </>
  )
}
