import type postcss from "postcss"
import { type LocalProperties, localProperties } from "../cssVars.ts"
import { interactiveModuleClasses } from "../jsxClasses.ts"
import { boxSides, pairSides, resolvePixels } from "../lengths.ts"
import { parseStyles } from "../parse.ts"
import { type TokenTable, tokenFile, tokenTable } from "../tokens.ts"
import {
  type Check,
  isSource,
  isStyle,
  type SourceFile,
  TOKENS_DIR,
  type Violation,
} from "../types.ts"

export const MIN_TARGET_PX = 44
export const CONTENT_ESTIMATE_PX = 24

const BLOCK_EXACT = new Set(["block-size", "height"])
const BLOCK_MIN = new Set(["min-block-size", "min-height"])
const INLINE_EXACT = new Set(["inline-size", "width"])
const INLINE_MIN = new Set(["min-inline-size", "min-width"])
const COMPOUND_SEPARATOR = /\s*[\s>+~]\s*/
const CLASS_IN_COMPOUND = /\.(-?[_a-zA-Z][\w-]*)/g
const INTERACTIVE_STATE = /:(hover|active|focus-visible|checked)/
const INTERACTIVE_COMPOSES = /\b(pressable|listItem)\b/

interface Context {
  readonly tokens: TokenTable
  readonly local: LocalProperties
}

type Axis = "block" | "inline"

function withoutArguments(selector: string): string {
  let current = selector
  for (let previous = ""; previous !== current; ) {
    previous = current
    current = current.replace(/\([^()]*\)/g, "")
  }
  return current
}

function compounds(selector: string): string[] {
  return withoutArguments(selector)
    .split(",")
    .flatMap((part) => part.trim().split(COMPOUND_SEPARATOR))
}

function interactiveClasses(root: postcss.Root): Set<string> {
  const classes = new Set<string>()
  root.walkRules((rule) => {
    for (const compound of compounds(rule.selector)) {
      if (!INTERACTIVE_STATE.test(compound) || compound.includes("::")) continue
      for (const match of compound.matchAll(CLASS_IN_COMPOUND)) classes.add(match[1] ?? "")
    }
    rule.walkDecls((declaration) => {
      const pointer = declaration.prop === "cursor" && declaration.value === "pointer"
      const composed =
        declaration.prop === "composes" && INTERACTIVE_COMPOSES.test(declaration.value)
      if (!pointer && !composed) return
      const last = compounds(rule.selector).at(-1) ?? ""
      for (const match of last.matchAll(CLASS_IN_COMPOUND)) classes.add(match[1] ?? "")
    })
  })
  return classes
}

function targetsClass(selector: string, name: string, pseudo: boolean): boolean {
  const own = new RegExp(`\\.${name}(?![\\w-])`)
  return withoutArguments(selector)
    .split(",")
    .some((part) => {
      const last = part.trim().split(COMPOUND_SEPARATOR).at(-1) ?? ""
      const hasPseudo = /::(before|after)/.test(last)
      return own.test(last) && hasPseudo === pseudo
    })
}

function declarationsOf(
  root: postcss.Root,
  name: string,
  pseudo: boolean,
): postcss.Declaration[] {
  const found: postcss.Declaration[] = []
  root.walkRules((rule) => {
    if (targetsClass(rule.selector, name, pseudo))
      rule.walkDecls((item) => {
        found.push(item)
      })
  })
  return found
}

function smallest(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0 ? null : Math.min(...known)
}

function paddingOf(
  declarations: readonly postcss.Declaration[],
  context: Context,
): number | null {
  const sides: (number | null)[] = []
  for (const { prop, value } of declarations) {
    const pixels = (part: string) => resolvePixels(part, context.local, context.tokens)
    if (prop === "padding") {
      const [top, , bottom] = boxSides(value)
      sides.push(sum(pixels(top), pixels(bottom)))
    }
    if (prop === "padding-block") sides.push(sum(...pairSides(value).map(pixels)))
  }
  return smallest(sides)
}

function sum(...values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function axisSize(
  declarations: readonly postcss.Declaration[],
  axis: Axis,
  context: Context,
): number | null {
  const [exactProps, minProps] =
    axis === "block" ? [BLOCK_EXACT, BLOCK_MIN] : [INLINE_EXACT, INLINE_MIN]
  const resolve = (props: ReadonlySet<string>) =>
    smallest(
      declarations
        .filter((item) => props.has(item.prop))
        .map((item) => resolvePixels(item.value, context.local, context.tokens))
        .map((pixels) => (pixels !== null && pixels > 0 ? pixels : null)),
    )
  const exact = resolve(exactProps)
  const minimum = resolve(minProps)
  if (exact !== null && minimum !== null) return Math.max(exact, minimum)
  const explicit = exact ?? minimum
  const stretched = declarations.some(
    (item) => item.prop === "align-self" && item.value === "stretch",
  )
  if (explicit !== null || axis === "inline" || stretched) return explicit
  const padding = paddingOf(declarations, context)
  return padding === null ? null : padding + CONTENT_ESTIMATE_PX
}

function insetsOf(declarations: readonly postcss.Declaration[], axis: Axis, context: Context) {
  const pixels = (part: string) => resolvePixels(part, context.local, context.tokens)
  let insets: (number | null)[] | null = null
  for (const { prop, value } of declarations) {
    const [top, right, bottom, left] = boxSides(value)
    if (prop === "inset")
      insets = axis === "block" ? [pixels(top), pixels(bottom)] : [pixels(right), pixels(left)]
    if (prop === `inset-${axis}`) insets = pairSides(value).map(pixels)
  }
  return insets
}

function hitArea(
  declarations: readonly postcss.Declaration[],
  axis: Axis,
  ownSize: number,
  context: Context,
): number {
  const explicit = axisSize(declarations, axis, context) ?? 0
  const insets = insetsOf(declarations, axis, context)
  const stretched =
    insets === null
      ? null
      : sum(ownSize, ...insets.map((inset) => (inset === null ? null : -inset)))
  return Math.max(explicit, stretched ?? 0)
}

function problem(root: postcss.Root, name: string, context: Context): string | null {
  const own = declarationsOf(root, name, false)
  const pseudo = declarationsOf(root, name, true)
  for (const axis of ["block", "inline"] as const) {
    const size = axisSize(own, axis, context)
    if (size === null || size >= MIN_TARGET_PX) continue
    if (hitArea(pseudo, axis, size, context) >= MIN_TARGET_PX) continue
    return `.${name} is ${size}px (${axis}) without a ${MIN_TARGET_PX}px hit area`
  }
  return null
}

export function smallTargets(
  file: SourceFile,
  tokens: TokenTable,
  fromMarkup: ReadonlySet<string> = new Set(),
): string[] {
  const root = parseStyles(file.text)
  const context: Context = { tokens, local: localProperties(file.text) }
  const names = new Set([...interactiveClasses(root), ...fromMarkup])
  return [...names].flatMap((name) => problem(root, name, context) ?? [])
}

function tokenProblems(files: readonly SourceFile[], tokens: TokenTable): Violation[] {
  const space = tokenFile(files, "space.css")
  if (space === undefined)
    return [
      { file: `${TOKENS_DIR}space.css`, message: "space.css with --target-min is missing" },
    ]
  return ["--target-min", "--control-height"].flatMap((token): Violation[] => {
    const pixels = resolvePixels(`var(${token})`, new Map(), tokens)
    return pixels !== null && pixels >= MIN_TARGET_PX
      ? []
      : [
          {
            file: space.path,
            message: `${token} is ${pixels ?? "not a length"}, below ${MIN_TARGET_PX}px`,
          },
        ]
  })
}

export const touchTargets: Check = {
  id: "touch-targets",
  run: (files) => {
    const tokens = tokenTable(files)
    const markup = interactiveModuleClasses(files.filter((item) => isSource(item.path)))
    const found = tokenProblems(files, tokens)
    for (const file of files.filter(
      (item) => isSource(item.path) && isStyle(item.path) && !item.path.startsWith(TOKENS_DIR),
    )) {
      for (const message of smallTargets(file, tokens, markup.get(file.path)))
        found.push({ file: file.path, message })
    }
    return found
  },
}
