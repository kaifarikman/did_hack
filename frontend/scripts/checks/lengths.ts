import { expandVars, type LocalProperties, splitWords } from "./cssVars.ts"
import type { TokenTable } from "./tokens.ts"

export const ROOT_FONT_PX = 16

const NUMBER_WITH_UNIT = /(\d*\.?\d+)(px|rem|em)\b/g
const TOKENS = /\d*\.?\d+|[-+*/()]/g
const ARITHMETIC = /^[\d.\s+\-*/()]*$/

export function evaluate(expression: string): number | null {
  const arithmetic = expression
    .replace(/calc/g, "")
    .replace(NUMBER_WITH_UNIT, (_match, amount: string, unit: string) =>
      String(unit === "px" ? Number(amount) : Number(amount) * ROOT_FONT_PX),
    )
  if (!ARITHMETIC.test(arithmetic)) return null
  const tokens = arithmetic.match(TOKENS) ?? []
  let index = 0
  const peek = () => tokens[index]
  const factor = (): number => {
    const token = tokens[index++]
    if (token === "(") {
      const inner = sum()
      index++
      return inner
    }
    if (token === "-") return -factor()
    return token === undefined ? Number.NaN : Number.parseFloat(token)
  }
  const product = (): number => {
    let value = factor()
    while (peek() === "*" || peek() === "/")
      value = tokens[index++] === "*" ? value * factor() : value / factor()
    return value
  }
  const sum = (): number => {
    let value = product()
    while (peek() === "+" || peek() === "-")
      value = tokens[index++] === "+" ? value + product() : value - product()
    return value
  }
  const result = sum()
  return Number.isFinite(result) && index === tokens.length ? result : null
}

export function resolvePixelVariants(
  value: string,
  local: LocalProperties,
  tokens: TokenTable,
): number[] {
  return expandVars(value, local, tokens)
    .map(evaluate)
    .filter((pixels): pixels is number => pixels !== null)
}

export function resolvePixels(
  value: string,
  local: LocalProperties,
  tokens: TokenTable,
): number | null {
  const variants = resolvePixelVariants(value, local, tokens)
  return variants.length === 0 ? null : Math.min(...variants)
}

export function boxSides(value: string): readonly [string, string, string, string] {
  const words = splitWords(value)
  const top = words[0] ?? "0"
  const right = words[1] ?? top
  const bottom = words[2] ?? top
  const left = words[3] ?? right
  return [top, right, bottom, left]
}

export function pairSides(value: string): readonly [string, string] {
  const words = splitWords(value)
  const start = words[0] ?? "0"
  return [start, words[1] ?? start]
}
