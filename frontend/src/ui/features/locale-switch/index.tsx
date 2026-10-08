import { useCallback, useEffect, useId, useRef, useState } from "react"
import { LOCALES, type Locale, useLocale, useMessageText } from "@/ui/shared/i18n"
import { settleDelay } from "@/ui/shared/motion"
import { Button, Flag, type FlagCode, MenuItemRadio, MenuList } from "@/ui/shared/ui"

const FLAGS: Readonly<Record<Locale, FlagCode>> = { ru: "ru", en: "gb" }

export function LocaleSwitch() {
  const text = useMessageText()
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const settle = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(settle.current), [])

  useEffect(() => {
    const keyboard = () => setViaKeyboard(true)
    const pointer = () => setViaKeyboard(false)
    document.addEventListener("keydown", keyboard, true)
    document.addEventListener("pointerdown", pointer, true)
    return () => {
      document.removeEventListener("keydown", keyboard, true)
      document.removeEventListener("pointerdown", pointer, true)
    }
  }, [])

  const close = useCallback((restoreFocus: boolean) => {
    window.clearTimeout(settle.current)
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  const choose = (next: Locale) => {
    setLocale(next)
    window.clearTimeout(settle.current)
    if (viaKeyboard) close(true)
    else settle.current = window.setTimeout(() => close(true), settleDelay())
  }

  const label = text({
    key: "common:language.current",
    params: { name: text({ key: `common:language.${locale}` }) },
  })

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        icon="globe"
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {label}
      </Button>
      <MenuList
        id={menuId}
        open={open}
        label={text({ key: "common:language.legend" })}
        anchorRef={trigger}
        instant={viaKeyboard}
        onClose={close}
      >
        {LOCALES.map((value) => (
          <MenuItemRadio key={value} checked={value === locale} onSelect={() => choose(value)}>
            <Flag code={FLAGS[value]} />
            <span lang={value}>{text({ key: `common:language.${value}` })}</span>
          </MenuItemRadio>
        ))}
      </MenuList>
    </>
  )
}
