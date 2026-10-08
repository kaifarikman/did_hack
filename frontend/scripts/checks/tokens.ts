import { type SourceFile, TOKENS_DIR } from "./types.ts"

const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g
const VAR_ONLY = /^var\((--[\w-]+)\)$/
const HEX = /^#([0-9a-f]{6})$/i
const MAX_DEPTH = 8
const LINEAR_THRESHOLD = 0.03928
const LINEAR_SLOPE = 12.92
const GAMMA_OFFSET = 0.055
const GAMMA_SCALE = 1.055
const GAMMA = 2.4
const LUMA = [0.2126, 0.7152, 0.0722] as const
const CONTRAST_OFFSET = 0.05
const CHANNEL_MAX = 255
const HEX_RADIX = 16

export type TokenTable = ReadonlyMap<string, string>

export function tokenFile(files: readonly SourceFile[], name: string): SourceFile | undefined {
  return files.find((file) => file.path === `${TOKENS_DIR}${name}`)
}

export function rootDeclarations(text: string): Map<string, string> {
  const rootPart = text.split("@media")[0] ?? ""
  return new Map(
    [...rootPart.matchAll(DECLARATION)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  )
}

export function tokenTable(files: readonly SourceFile[]): TokenTable {
  const table = new Map<string, string>()
  for (const file of files.filter((item) => item.path.startsWith(TOKENS_DIR))) {
    for (const [name, value] of rootDeclarations(file.text)) table.set(name, value)
  }
  return table
}

export function resolveToken(table: TokenTable, name: string, depth = 0): string | null {
  const value = table.get(name)
  if (value === undefined || depth > MAX_DEPTH) return null
  const reference = VAR_ONLY.exec(value)
  return reference === null ? value : resolveToken(table, reference[1] ?? "", depth + 1)
}

function channel(value: number): number {
  const ratio = value / CHANNEL_MAX
  return ratio <= LINEAR_THRESHOLD
    ? ratio / LINEAR_SLOPE
    : ((ratio + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA
}

export function luminance(hex: string): number | null {
  const match = HEX.exec(hex)
  if (match === null) return null
  const digits = match[1] ?? ""
  const channels = [0, 2, 4].map((start) =>
    channel(Number.parseInt(digits.slice(start, start + 2), HEX_RADIX)),
  )
  return channels.reduce((sum, value, index) => sum + value * (LUMA[index] ?? 0), 0)
}

export function contrastRatio(foreground: string, background: string): number | null {
  const front = luminance(foreground)
  const back = luminance(background)
  if (front === null || back === null) return null
  return (Math.max(front, back) + CONTRAST_OFFSET) / (Math.min(front, back) + CONTRAST_OFFSET)
}
