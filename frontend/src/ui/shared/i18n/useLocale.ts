import { use } from "react"
import { LocaleContext, type LocaleState } from "./LocaleProvider"

export function useLocale(): LocaleState {
  const value = use(LocaleContext)
  if (value === null) throw new Error("useLocale must be used within LocaleProvider")
  return value
}

export type { LocaleState } from "./LocaleProvider"
