import type { i18n as I18nInstance } from "i18next"
import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { i18n as defaultInstance } from "./instance"
import { DEFAULT_LOCALE, isLocale, type Locale, storeLocale } from "./locale"

export interface LocaleState {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
}

export const LocaleContext = createContext<LocaleState | null>(null)

export interface LocaleProviderProps {
  readonly children: ReactNode
  readonly instance?: I18nInstance
}

function currentLocale(instance: I18nInstance): Locale {
  const language = instance.resolvedLanguage ?? instance.language
  return isLocale(language) ? language : DEFAULT_LOCALE
}

export function LocaleProvider({ children, instance = defaultInstance }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => currentLocale(instance))

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    storeLocale(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = instance.getFixedT(locale, "common")("app.documentTitle")
    if (instance.language !== locale) void instance.changeLanguage(locale)
  }, [instance, locale])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  return (
    <I18nextProvider i18n={instance}>
      <LocaleContext value={value}>{children}</LocaleContext>
    </I18nextProvider>
  )
}
