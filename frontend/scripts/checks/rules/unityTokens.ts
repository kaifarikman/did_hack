import { contrastRatio, resolveToken, type TokenTable, tokenTable } from "../tokens.ts"
import { type Check, TOKENS_DIR, type Violation } from "../types.ts"

export const MIN_CONTRAST = 4.5
export const MIN_NON_TEXT_CONTRAST = 3

export const TEXT_SURFACES = [
  "--surface-canvas",
  "--surface-card",
  "--surface-tint",
  "--surface-selected",
]
export const INVERSE_SURFACES = [
  "--surface-inverse",
  "--surface-inverse-strong",
  "--action-dark",
]
export const ON_SURFACES: Readonly<Record<string, readonly string[]>> = {
  "--text-on-inverse": INVERSE_SURFACES,
  "--text-on-inverse-secondary": ["--surface-inverse"],
  "--text-on-action": ["--action-primary"],
  "--text-on-tooltip": ["--surface-tooltip"],
}
export const EXEMPT_TEXT = new Set(["--text-disabled"])
export const MAP_BACKGROUNDS = ["--data-free", "--data-unknown"]
export const MAP_MARKERS = [
  "--data-obstacle",
  "--data-sample",
  "--data-hazard",
  "--data-robot",
  "--data-robot-partner",
  "--data-goal",
  "--data-base",
  "--data-critical",
  "--data-path",
  "--data-label",
]
const FIXED_NON_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["--border-strong", "--surface-card"],
  ["--border-strong", "--surface-tint"],
  ["--action-dark", "--surface-card"],
  ["--action-dark", "--surface-tint"],
]

type Pair = readonly [string, string, number]

export function contrastPairs(tokens: TokenTable): Pair[] {
  const names = [...tokens.keys()]
  const texts = names.filter((name) => name.startsWith("--text-") && !EXEMPT_TEXT.has(name))
  const textPairs = texts.flatMap((text): Pair[] => {
    if (!text.startsWith("--text-on-"))
      return TEXT_SURFACES.map((surface) => [text, surface, MIN_CONTRAST])
    const surfaces = ON_SURFACES[text] ?? [text.replace("--text-on-", "--surface-")]
    return surfaces.map((surface) => [text, surface, MIN_CONTRAST])
  })
  const rings: Pair[] = [
    ...TEXT_SURFACES.map(
      (surface): Pair => ["--focus-ring-color", surface, MIN_NON_TEXT_CONTRAST],
    ),
    ...INVERSE_SURFACES.map(
      (surface): Pair => ["--focus-ring-color-inverse", surface, MIN_NON_TEXT_CONTRAST],
    ),
  ]
  const markers = MAP_MARKERS.filter((name) => tokens.has(name)).flatMap((marker) =>
    MAP_BACKGROUNDS.map((background): Pair => [marker, background, MIN_NON_TEXT_CONTRAST]),
  )
  const fixed = FIXED_NON_TEXT.map(
    ([front, back]): Pair => [front, back, MIN_NON_TEXT_CONTRAST],
  )
  return [...textPairs, ...rings, ...markers, ...fixed]
}

const tokenViolation = (file: string, message: string): Violation => ({
  file: `${TOKENS_DIR}${file}`,
  message,
})

export const contrast: Check = {
  id: "contrast",
  run: (files) => {
    const table = tokenTable(files)
    if (!table.has("--surface-card"))
      return [tokenViolation("semantic.css", "semantic tokens are missing")]
    return contrastPairs(table).flatMap(([front, back, minimum]): Violation[] => {
      const foreground = resolveToken(table, front)
      const background = resolveToken(table, back)
      const ratio =
        foreground === null || background === null
          ? null
          : contrastRatio(foreground, background)
      if (ratio === null)
        return [tokenViolation("semantic.css", `cannot resolve ${front} on ${back}`)]
      return ratio < minimum
        ? [tokenViolation("semantic.css", `${front} on ${back} is ${ratio.toFixed(2)}:1`)]
        : []
    })
  },
}

const SURFACES = ["--surface-canvas", "--surface-card", "--surface-tint", "--surface-inverse"]
const HOVER_STEP = /^color-mix\(in oklab, var\((--[\w-]+)\), var\(--carbon\) (\d+)%\)$/
export const MAX_HOVER_STEP = 8

export const surfaceLadder: Check = {
  id: "surface-ladder",
  run: (files) => {
    const table = tokenTable(files)
    if (table.size === 0) return [tokenViolation("semantic.css", "semantic tokens are missing")]
    const resolved = SURFACES.map((name) => resolveToken(table, name))
    const found: Violation[] = []
    if (new Set(resolved).size !== SURFACES.length || resolved.includes(null)) {
      found.push(
        tokenViolation("semantic.css", "surfaces canvas, card, tint, inverse must be distinct"),
      )
    }
    for (const name of ["--surface-card-hover", "--surface-tint-hover"]) {
      const step = HOVER_STEP.exec(table.get(name) ?? "")
      if (step === null || Number(step[2]) > MAX_HOVER_STEP) {
        found.push(
          tokenViolation(
            "semantic.css",
            `${name} must mix its base with carbon by <= ${MAX_HOVER_STEP}%`,
          ),
        )
      }
    }
    return found
  },
}
