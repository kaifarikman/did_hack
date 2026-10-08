import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { Field } from "../field"
import { Icon } from "../icon"
import { Popover, useListNavigation } from "../popover"
import { ScrollArea } from "../scroll-area"
import styles from "./styles.module.css"

export interface SelectOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean | undefined
}

export interface SelectProps<T extends string> {
  readonly label: string
  readonly value: T | null
  readonly options: readonly SelectOption<T>[]
  readonly onChange: (value: T) => void
  readonly placeholder?: string | undefined
  readonly hint?: string | undefined
  readonly error?: string | undefined
  readonly disabled?: boolean | undefined
  readonly hideLabel?: boolean | undefined
  readonly className?: string | undefined
}

const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " "])

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  error,
  disabled = false,
  hideLabel = false,
  className,
}: SelectProps<T>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listId = useId()
  const navigation = useListNavigation(options)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]
  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId])
  const close = useCallback(() => setOpen(false), [])

  const openList = () => {
    navigation.setActiveIndex(selectedIndex >= 0 ? selectedIndex : navigation.activeIndex)
    setOpen(true)
  }
  const choose = (index: number) => {
    const option = options[index]
    if (option === undefined || option.disabled === true) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    setViaKeyboard(true)
    if (!open) {
      if (OPEN_KEYS.has(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      choose(navigation.activeIndex)
    } else if (event.key === "Tab") {
      choose(navigation.activeIndex)
    } else if (navigation.handleKey(event.key)) {
      event.preventDefault()
    }
  }
  const activeDescendant = useMemo(
    () => (open && navigation.activeIndex >= 0 ? optionId(navigation.activeIndex) : undefined),
    [open, navigation.activeIndex, optionId],
  )
  useEffect(() => {
    if (activeDescendant === undefined) return
    const option = document.getElementById(activeDescendant)
    if (typeof option?.scrollIntoView === "function")
      option.scrollIntoView({ block: "nearest" })
  }, [activeDescendant])

  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {(control, meta) => (
        <>
          <button
            {...control}
            ref={triggerRef}
            type="button"
            role="combobox"
            className={styles.trigger}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeDescendant}
            disabled={disabled}
            data-open={open}
            data-instant={viaKeyboard}
            onClick={() => (open ? close() : openList())}
            onKeyDown={onKeyDown}
            onPointerDown={() => setViaKeyboard(false)}
          >
            <span className={styles.value} data-placeholder={selected === undefined}>
              {selected?.label ?? placeholder ?? t("select.placeholder")}
            </span>
            <Icon name="chevron-down" size="sm" className={styles.chevron} />
          </button>
          <Popover
            open={open}
            onClose={close}
            anchorRef={triggerRef}
            matchAnchorWidth
            instant={viaKeyboard}
            className={styles.popover}
          >
            <ScrollArea className={styles.scroller}>
              <div
                role="listbox"
                id={listId}
                aria-labelledby={meta.labelId}
                className={styles.list}
              >
                {options.map((option, index) => (
                  <div
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled === true}
                    className={styles.option}
                    data-active={index === navigation.activeIndex}
                    onPointerMove={() => navigation.setActiveIndex(index)}
                    onClick={() => choose(index)}
                    onKeyDown={() => undefined}
                  >
                    <span>{option.label}</span>
                    {option.value === value ? <Icon name="check" size="sm" /> : null}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Popover>
        </>
      )}
    </Field>
  )
}
