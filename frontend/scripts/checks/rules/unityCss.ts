import {
  expandVars,
  type LocalProperties,
  localProperties,
  referencedNames,
  splitWords,
} from "../cssVars.ts"
import { type AstNode, parseScript, parseStyles, walkAst } from "../parse.ts"
import { rootDeclarations, type TokenTable, tokenFile, tokenTable } from "../tokens.ts"
import {
  type Check,
  isScript,
  isSource,
  isStyle,
  type SourceFile,
  TOKENS_DIR,
  type Violation,
} from "../types.ts"
import { literalStrings } from "./texts.ts"

export const ALLOWED_BREAKPOINTS = new Set(["30rem", "48rem", "64rem", "75rem"])
export const SIGNAL_SCOPES = ["src/ui/shared/ui/meter/", "src/ui/features/map/"]
const SIGNAL_NAME = /^--(signal|data)-/
const MEDIA_LENGTH = /(\d*\.?\d+)(rem|px|em)/g
const SPACING_PROPERTY =
  /^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$|^inset(-(block|inline)(-(start|end))?)?$|^(top|right|bottom|left)$/
const LENGTH_LITERAL = /(?<![\w.-])(?!0(?:px|rem|em)(?![\w.]))\d*\.?\d+(px|rem|em)\b/
const SCALE_WORD = (prefix: string) => new RegExp(`^(0|inherit|var\\(--${prefix}[\\w-]*\\))$`)
const NO_TOKENS: TokenTable = new Map()

export function componentStyles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter(
    (file) => isSource(file.path) && isStyle(file.path) && !file.path.startsWith(TOKENS_DIR),
  )
}

export interface DeclarationContext {
  readonly prop: string
  readonly value: string
  readonly selector: string
  readonly local: LocalProperties
  readonly tokens: TokenTable
}

export function eachDeclaration(
  files: readonly SourceFile[],
  inspect: (context: DeclarationContext) => string | null,
): Violation[] {
  const tokens = tokenTable(files)
  return componentStyles(files).flatMap((file) => {
    const found: Violation[] = []
    const local = localProperties(file.text)
    parseStyles(file.text).walkDecls((declaration) => {
      const parent = declaration.parent as { selector?: string } | undefined
      const problem = inspect({
        prop: declaration.prop,
        value: declaration.value,
        selector: parent?.selector ?? "",
        local,
        tokens,
      })
      if (problem !== null)
        found.push({
          file: file.path,
          message: `${problem}: ${declaration.prop}: ${declaration.value}`,
        })
    })
    return found
  })
}

function onScale(value: string, local: LocalProperties, prefix: string): boolean {
  return expandVars(value, local, NO_TOKENS).every((variant) =>
    splitWords(variant).every((word) => SCALE_WORD(prefix).test(word)),
  )
}

export function scaleProblem({ prop, value, local }: DeclarationContext): string | null {
  if (prop.startsWith("--")) return null
  if (prop.endsWith("radius") && !onScale(value, local, "radius-"))
    return "radius outside --radius-*"
  if (prop === "box-shadow" && value !== "none" && value !== "var(--shadow-float)")
    return "shadow other than --shadow-float"
  if (prop === "font" && value !== "inherit") return "font shorthand instead of font tokens"
  if (prop === "font-size" && !onScale(value, local, "font-size-"))
    return "font size outside --font-size-*"
  if (prop === "z-index" && !onScale(value, local, "layer-")) return "z-index outside --layer-*"
  const spacing = SPACING_PROPERTY.test(prop)
  if (spacing && expandVars(value, local, NO_TOKENS).some((item) => LENGTH_LITERAL.test(item)))
    return "spacing outside --space-*"
  return null
}

function breakpointProblems(path: string, query: string): Violation[] {
  return [...query.matchAll(MEDIA_LENGTH)]
    .map((match) => `${match[1]}${match[2]}`)
    .filter((length) => !ALLOWED_BREAKPOINTS.has(length))
    .map((length) => ({ file: path, message: `breakpoint ${length}` }))
}

function queryProblems(file: SourceFile): Violation[] {
  const found: Violation[] = []
  parseStyles(file.text).walkAtRules(/^(media|container)$/, (rule) => {
    found.push(...breakpointProblems(file.path, rule.params))
  })
  return found
}

function scriptQueryProblems(file: SourceFile): Violation[] {
  const found: Violation[] = []
  walkAst(parseScript(file.path, file.text).program, (node: AstNode) => {
    const callee = node.callee as AstNode | undefined
    const name = callee?.name ?? (callee?.property as AstNode | undefined)?.name
    if (node.type !== "CallExpression" || name !== "matchMedia") return
    const [query] = (node.arguments as readonly AstNode[] | undefined) ?? []
    for (const text of literalStrings(query)) found.push(...breakpointProblems(file.path, text))
  })
  return found
}

export const scaleTokens: Check = {
  id: "scale-tokens",
  run: (files) => [
    ...eachDeclaration(files, scaleProblem),
    ...componentStyles(files).flatMap(queryProblems),
    ...files
      .filter((file) => isSource(file.path) && isScript(file.path))
      .flatMap(scriptQueryProblems),
  ],
}

export const tokenLayers: Check = {
  id: "token-layers",
  run: (files) => {
    const palette = tokenFile(files, "palette.css")
    if (palette === undefined)
      return [{ file: `${TOKENS_DIR}palette.css`, message: "palette.css is missing" }]
    const paletteNames = new Set(rootDeclarations(palette.text).keys())
    return eachDeclaration(files, ({ value, local }) => {
      const raw = [...referencedNames(value, local, NO_TOKENS)].find((name) =>
        paletteNames.has(name),
      )
      return raw === undefined ? null : `palette token ${raw} used directly`
    })
  },
}

export function signalTokens(tokens: TokenTable): Set<string> {
  return new Set(
    [...tokens.keys()].filter((name) =>
      [name, ...referencedNames(`var(${name})`, new Map(), tokens)].some((item) =>
        SIGNAL_NAME.test(item),
      ),
    ),
  )
}

function inSignalScope(path: string): boolean {
  return SIGNAL_SCOPES.some((scope) => path.startsWith(scope)) || path.startsWith(TOKENS_DIR)
}

const CUSTOM_NAME = /--[\w-]+/g

export const signalScope: Check = {
  id: "signal-scope",
  run: (files) => {
    const signals = signalTokens(tokenTable(files))
    const isSignal = (name: string) => SIGNAL_NAME.test(name) || signals.has(name)
    return files
      .filter((file) => isSource(file.path) && (isStyle(file.path) || isScript(file.path)))
      .filter((file) => !inSignalScope(file.path))
      .flatMap((file) => {
        const local = isStyle(file.path) ? localProperties(file.text) : new Map()
        const names = new Set(
          [...file.text.matchAll(CUSTOM_NAME)].flatMap((match) => [
            match[0],
            ...referencedNames(`var(${match[0]})`, local, NO_TOKENS),
          ]),
        )
        return [...names].filter(isSignal).map(
          (name): Violation => ({
            file: file.path,
            message: `${name} outside data visualisation`,
          }),
        )
      })
  },
}
