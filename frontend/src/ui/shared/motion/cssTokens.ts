export type DurationToken =
  | `--dur-${string}`
  | `--delay-${string}`
  | "--typeahead-reset"
  | "--hold-skeleton"
  | "--stagger"
  | "--reduced-fade"
  | "--reduced-fade-exit"
  | "--view-transition-limit"

export type EasingToken = "--ease-out" | "--ease-in-out" | "--ease-drawer" | "--ease-linear"

const MS_PER_SECOND = 1000
const DURATION_PATTERN = /^(-?\d*\.?\d+)(ms|s)$/

export function readToken(token: string, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(token).trim()
}

export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim())
  if (match === null) return 0
  const amount = Number(match[1])
  return match[2] === "s" ? amount * MS_PER_SECOND : amount
}

export function motionMs(token: DurationToken, element?: Element): number {
  return parseDuration(readToken(token, element))
}

const PIXEL_PATTERN = /^(-?\d*\.?\d+)px$/

export function readPixels(token: `--${string}`, element?: Element): number {
  const match = PIXEL_PATTERN.exec(readToken(token, element))
  return match === null ? 0 : Number(match[1])
}

export function readEasing(token: EasingToken, element?: Element): string {
  const value = readToken(token, element)
  return value === "" ? "linear" : value
}
