import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef } from "react"
import { Icon } from "../icon"
import { type Placement, Popover } from "../popover"
import styles from "./styles.module.css"
import { useCheckedIndicator } from "./useCheckedIndicator"

const MENU_ITEM = '[role^="menuitem"]'

export function nextIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  if (key === "ArrowDown") return (current + 1) % count
  if (key === "ArrowUp") return (current - 1 + count) % count
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu === null ? [] : [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)]
}

export interface MenuListProps {
  readonly id: string
  readonly open: boolean
  readonly label: string
  readonly anchorRef: RefObject<HTMLElement | null>
  readonly onClose: (restoreFocus: boolean) => void
  readonly placement?: Placement | undefined
  readonly instant?: boolean | undefined
  readonly children: ReactNode
}

export function MenuList({
  id,
  open,
  label,
  anchorRef,
  onClose,
  placement = "bottom-end",
  instant = false,
  children,
}: MenuListProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  useCheckedIndicator(menuRef, indicatorRef, open)

  useEffect(() => {
    if (!open) return
    const items = menuItems(menuRef.current)
    const checked = items.find((item) => item.getAttribute("aria-checked") === "true")
    ;(checked ?? items[0])?.focus()
  }, [open])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      onClose(false)
      return
    }
    const items = menuItems(menuRef.current)
    const next = nextIndex(
      event.key,
      items.indexOf(document.activeElement as HTMLElement),
      items.length,
    )
    if (next === null) return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <Popover
      open={open}
      onClose={() => onClose(false)}
      anchorRef={anchorRef}
      placement={placement}
      instant={instant}
    >
      <div
        ref={menuRef}
        id={id}
        role="menu"
        aria-label={label}
        className={styles.list}
        onKeyDown={navigate}
      >
        <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
        {children}
      </div>
    </Popover>
  )
}

export interface MenuItemRadioProps {
  readonly checked: boolean
  readonly onSelect: () => void
  readonly children: ReactNode
}

export function MenuItemRadio({ checked, onSelect, children }: MenuItemRadioProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={styles.radio}
      onClick={onSelect}
    >
      {children}
      <span className={styles.check} data-on={checked} data-motion="fade" aria-hidden="true">
        <Icon name="check" size="sm" />
      </span>
    </button>
  )
}
