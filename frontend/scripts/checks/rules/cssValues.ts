import { expandVars, localProperties, splitTopLevel, splitWords } from "../cssVars.ts"
import { LITERAL_PATTERNS } from "../literals.ts"
import { parseStyles } from "../parse.ts"
import { type TokenTable, tokenTable } from "../tokens.ts"
import {
  type Check,
  isScript,
  isSource,
  isStyle,
  type SourceFile,
  TOKENS_DIR,
  type Violation,
} from "../types.ts"
import {
  scriptCustomProperties,
  scriptStyleLiterals,
  scriptTokenNames,
} from "./scriptStyles.ts"

const SIZE_LITERAL = /(?<![\w-])\d*\.?\d+(px|rem|em|%)/
const VAR_CALL = /var\([^()]*\)/g
const SHADOW_TOKEN = /^var\(--shadow-[\w-]*\)$/
export const ALLOWED_TRANSITION_PROPERTIES = new Set([
  "transform",
  "opacity",
  "clip-path",
  "filter",
  "scale",
  "translate",
  "rotate",
  "background-color",
  "color",
  "border-color",
  "outline-color",
  "stroke-dashoffset",
])
const MOTION_TOKEN_PREFIX = /^--(motion|transition|dur|ease|delay)-/
const TOKEN_ONLY = (prefix: string) => new RegExp(`^var\\(--${prefix}[\\w-]*\\)$`)

function componentStyles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter(
    (file) => isSource(file.path) && isStyle(file.path) && !file.path.startsWith(TOKENS_DIR),
  )
}

export function literalProblems(prop: string, value: string, important: boolean): string[] {
  const problems = LITERAL_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(
    ([name]) => name,
  )
  if (important) problems.push("!important")
  const withoutVars = value.replace(VAR_CALL, "")
  if (prop.includes("radius") && SIZE_LITERAL.test(withoutVars)) problems.push("radius literal")
  const shadow = prop.endsWith("shadow") || (prop === "filter" && value.includes("drop-shadow"))
  if (shadow && value !== "none" && !SHADOW_TOKEN.test(value)) problems.push("shadow literal")
  return problems
}

export const cssLiterals: Check = {
  id: "css-literals",
  run: (files) => [
    ...componentStyles(files).flatMap((file) => {
      const found: Violation[] = []
      parseStyles(file.text).walkDecls((declaration) => {
        for (const problem of literalProblems(
          declaration.prop,
          declaration.value,
          declaration.important,
        )) {
          found.push({
            file: file.path,
            message: `${problem}: ${declaration.prop}: ${declaration.value}`,
          })
        }
      })
      return found
    }),
    ...files
      .filter((file) => isSource(file.path) && isScript(file.path))
      .flatMap((file) =>
        scriptStyleLiterals(file).map((message): Violation => ({ file: file.path, message })),
      ),
  ],
}

function transitionedProperties(value: string): string[] {
  return splitTopLevel(value, ",").map((part) => splitWords(part)[0] ?? "")
}

function propertyProblems(prop: string, variants: readonly string[]): string[] {
  return variants
    .flatMap((variant) =>
      prop === "transition" ? transitionedProperties(variant) : splitTopLevel(variant, ","),
    )
    .filter((property) => property !== "none" && !/^(--|var\()/.test(property))
    .filter((property) => !ALLOWED_TRANSITION_PROPERTIES.has(property))
    .map((property) => `property ${property}`)
}

function hasLiteralTiming(prop: string, value: string): boolean {
  if (prop !== "transition" || value === "none" || TOKEN_ONLY("transition-").test(value))
    return false
  return splitTopLevel(value, ",").some((part) =>
    splitWords(part)
      .slice(1)
      .some((word) => !word.startsWith("var(")),
  )
}

function transitionProblems(
  prop: string,
  value: string,
  variants: readonly string[],
): string[] {
  const problems = propertyProblems(prop, variants)
  if (hasLiteralTiming(prop, value)) problems.push("timing without tokens")
  return [...new Set(problems)]
}

function animationProblems(variants: readonly string[], tokens: TokenTable): string[] {
  return variants.flatMap((variant) =>
    splitTopLevel(variant, ",").flatMap((part) => {
      if (part === "none") return []
      const token = /^var\((--motion-[\w-]+)\)$/.exec(part)?.[1]
      return token !== undefined && tokens.has(token)
        ? []
        : ["animation without a --motion-* token"]
    }),
  )
}

export function motionProblems(
  prop: string,
  value: string,
  local: ReadonlyMap<string, readonly string[]> = new Map(),
  tokens: TokenTable = new Map(),
): string[] {
  if (MOTION_TOKEN_PREFIX.test(prop)) return [`motion token ${prop} declared outside tokens`]
  if (prop === "transition" || prop === "transition-property")
    return transitionProblems(prop, value, expandVars(value, local, tokens))
  if (prop === "animation")
    return animationProblems(expandVars(value, local, new Map()), tokens)
  if (prop === "animation-name") return ["animation-name outside tokens"]
  if (prop.endsWith("-duration") && !TOKEN_ONLY("dur-").test(value))
    return ["duration without --dur-* token"]
  return []
}

export const cssTransitions: Check = {
  id: "css-transitions",
  run: (files) => {
    const tokens = tokenTable(files)
    return componentStyles(files).flatMap((file) => {
      const found: Violation[] = []
      const local = localProperties(file.text)
      const root = parseStyles(file.text)
      root.walkAtRules("keyframes", (rule) => {
        found.push({ file: file.path, message: `@keyframes ${rule.params} outside tokens` })
      })
      root.walkDecls((declaration) => {
        for (const problem of motionProblems(
          declaration.prop,
          declaration.value,
          local,
          tokens,
        ))
          found.push({
            file: file.path,
            message: `${problem}: ${declaration.prop}: ${declaration.value}`,
          })
      })
      return found
    })
  },
}

const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g
const CUSTOM_PROPERTY = /(--[\w-]+)\s*:/g

export const cssTokenRefs: Check = {
  id: "css-token-refs",
  run: (files) => {
    const tokenNames = new Set(
      files
        .filter((file) => file.path.startsWith(TOKENS_DIR))
        .flatMap((file) =>
          [...file.text.matchAll(CUSTOM_PROPERTY)].map((match) => match[1] ?? ""),
        ),
    )
    const scripts = files.filter((file) => isSource(file.path) && isScript(file.path))
    const fromScripts = new Set(scripts.flatMap(scriptCustomProperties))
    const styleProblems = files
      .filter((file) => isSource(file.path) && isStyle(file.path))
      .flatMap((file) => {
        const local = new Set(
          [...file.text.matchAll(CUSTOM_PROPERTY)].map((match) => match[1] ?? ""),
        )
        const references = new Set(
          [...file.text.matchAll(VAR_REFERENCE)].map((match) => match[1] ?? ""),
        )
        return [...references]
          .filter((name) => !tokenNames.has(name) && !local.has(name) && !fromScripts.has(name))
          .map(
            (name): Violation => ({
              file: file.path,
              message: `unknown custom property ${name}`,
            }),
          )
      })
    const scriptProblems = scripts.flatMap((file) =>
      scriptTokenNames(file)
        .filter((name) => !tokenNames.has(name))
        .map(
          (name): Violation => ({
            file: file.path,
            message: `script reads unknown token ${name}`,
          }),
        ),
    )
    return [...styleProblems, ...scriptProblems]
  },
}
