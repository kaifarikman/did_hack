import { INTL_LOCALE, type Locale } from "./locale"

export type MeasureUnit =
  | "meter"
  | "second"
  | "minute"
  | "percent"
  | "degree"
  | "meter-per-second"

export interface Formatters {
  readonly number: (value: number, fractionDigits?: number) => string
  readonly integer: (value: number) => string
  readonly percent: (ratio: number, fractionDigits?: number) => string
  readonly unit: (value: number, unit: MeasureUnit, fractionDigits?: number) => string
  readonly duration: (seconds: number) => string
  readonly time: (value: Date | string | number) => string
  readonly dateTime: (value: Date | string | number) => string
  readonly list: (items: readonly string[]) => string
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

function digits(fractionDigits: number): Intl.NumberFormatOptions {
  return { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
}

function numberFormatCache(
  tag: string,
): (options: Intl.NumberFormatOptions) => Intl.NumberFormat {
  const cache = new Map<string, Intl.NumberFormat>()
  return (options) => {
    const key = JSON.stringify(options)
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const format = new Intl.NumberFormat(tag, options)
    cache.set(key, format)
    return format
  }
}

export function createFormatters(locale: Locale): Formatters {
  const tag = INTL_LOCALE[locale]
  const numberFormat = numberFormatCache(tag)
  const unitListFormat = new Intl.ListFormat(tag, { style: "narrow", type: "unit" })
  const timeFormat = new Intl.DateTimeFormat(tag, { timeStyle: "medium" })
  const dateTimeFormat = new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const listFormat = new Intl.ListFormat(tag, { style: "long", type: "conjunction" })
  const unitFormat = (value: number, unit: string, fractionDigits = 0) =>
    numberFormat({
      style: "unit",
      unit,
      unitDisplay: "short",
      ...digits(fractionDigits),
    }).format(value)

  const duration = (seconds: number) => {
    const total = Math.max(0, Math.round(seconds))
    const hours = Math.floor(total / SECONDS_PER_HOUR)
    const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
    const rest = total % SECONDS_PER_MINUTE
    const parts = [
      hours > 0 ? unitFormat(hours, "hour") : null,
      hours > 0 || minutes > 0 ? unitFormat(minutes, "minute") : null,
      unitFormat(rest, "second"),
    ].filter((part): part is string => part !== null)
    return unitListFormat.format(parts)
  }

  return {
    number: (value, fractionDigits = 1) => numberFormat(digits(fractionDigits)).format(value),
    integer: (value) => numberFormat({ maximumFractionDigits: 0 }).format(value),
    percent: (ratio, fractionDigits = 0) =>
      numberFormat({ style: "percent", ...digits(fractionDigits) }).format(ratio),
    unit: unitFormat,
    duration,
    time: (value) => timeFormat.format(new Date(value)),
    dateTime: (value) => dateTimeFormat.format(new Date(value)),
    list: (items) => listFormat.format(items),
  }
}
