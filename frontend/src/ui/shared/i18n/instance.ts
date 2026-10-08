import i18next, { type i18n as I18nInstance } from "i18next"
import { initReactI18next } from "react-i18next"
import { DEFAULT_LOCALE, LOCALES, type Locale, readStoredLocale } from "./locale"
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from "./resources"

export function createI18n(locale: Locale = readStoredLocale()): I18nInstance {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return instance
}

export const i18n = createI18n()
