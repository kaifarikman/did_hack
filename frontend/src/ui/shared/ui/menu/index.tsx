import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "../button"
import { Icon, type IconName } from "../icon"
import { type Placement, Popover, useListNavigation } from "../popover"
import styles from "./styles.module.css"

export interface MenuItem {
  readonly id: string
  readonly label: string
  readonly icon?: IconName | undefined
  readonly disabled?: boolean | undefined
  readonly onSelect: () => void
}

export interface MenuProps {
  readonly label?: string | undefined
  readonly icon?: IconName | undefined
  readonly items: readonly MenuItem[]
  readonly placement?: Placement | undefined
  readonly className?: string | undefined
}

export function Menu({
  label,
  icon = "more",
  items,
  placement = "bottom-end",
  className,
}: MenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef(new Map<number, HTMLButtonElement>())
  const menuId = useId()
  const navigation = useListNavigation(items)
  const close = useCallback(() => setOpen(false), [])
  const { activeIndex, setActiveIndex } = navigation

  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current.get(activeIndex)?.focus()
  }, [open, activeIndex])

  const openMenu = (index: number) => {
    setActiveIndex(index)
    setOpen(true)
  }
  const select = (item: MenuItem) => {
    if (item.disabled === true) return
    setOpen(false)
    triggerRef.current?.focus()
    item.onSelect()
  }
  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    setViaKeyboard(true)
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    openMenu(event.key === "ArrowDown" ? 0 : items.length - 1)
  }
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    setViaKeyboard(true)
    if (event.key === "Tab") {
      close()
      return
    }
    if (navigation.handleKey(event.key)) event.preventDefault()
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="compact"
        icon={icon}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label === undefined ? t("action.more") : undefined}
        onClick={() => (open ? close() : openMenu(0))}
        onKeyDown={onTriggerKey}
        onPointerDown={() => setViaKeyboard(false)}
      >
        {label ?? null}
      </Button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement={placement}
        instant={viaKeyboard}
      >
        <div role="menu" id={menuId} className={styles.menu} onKeyDown={onMenuKey}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                if (element === null) itemRefs.current.delete(index)
                else itemRefs.current.set(index, element)
              }}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              className={styles.item}
              disabled={item.disabled}
              data-active={index === activeIndex}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => select(item)}
            >
              {item.icon === undefined ? null : <Icon name={item.icon} size="sm" />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

export {
  MenuItemRadio,
  type MenuItemRadioProps,
  MenuList,
  type MenuListProps,
  nextIndex,
} from "./list"
export { placeIndicator, useCheckedIndicator } from "./useCheckedIndicator"
