import { useMemo } from "react"
import { createFormatters, type Formatters } from "./formatters"
import { useLocale } from "./useLocale"

export function useFormatters(): Formatters {
  const { locale } = useLocale()
  return useMemo(() => createFormatters(locale), [locale])
}
