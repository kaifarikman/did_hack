import { parseStyles } from "./parse.ts"
import type { TokenTable } from "./tokens.ts"

export type LocalProperties = ReadonlyMap<string, readonly string[]>

const VAR_NAME = /var\(\s*(--[\w-]+)/g
const MAX_DEPTH = 8
const MAX_VARIANTS = 16

export function varNames(value: string): string[] {
  return [...value.matchAll(VAR_NAME)].map((match) => match[1] ?? "")
}

export function localProperties(text: string): LocalProperties {
  const local = new Map<string, string[]>()
  parseStyles(text).walkDecls((declaration) => {
    if (!declaration.prop.startsWith("--")) return
    local.set(declaration.prop, [...(local.get(declaration.prop) ?? []), declaration.value])
  })
  return local
}

export function definitionsOf(
  name: string,
  local: LocalProperties,
  tokens: TokenTable,
): readonly string[] {
  const own = local.get(name)
  if (own !== undefined) return own
  const token = tokens.get(name)
  return token === undefined ? [] : [token]
}

interface VarCall {
  readonly text: string
  readonly name: string
  readonly fallback: string | undefined
}

function firstVarCall(value: string): VarCall | null {
  const start = value.indexOf("var(")
  if (start === -1) return null
  let depth = 0
  for (let index = start + 3; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1
    if (value[index] === ")") depth -= 1
    if (depth > 0) continue
    const text = value.slice(start, index + 1)
    const inner = text.slice(4, -1)
    const comma = inner.indexOf(",")
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    return { text, name, fallback: comma === -1 ? undefined : inner.slice(comma + 1).trim() }
  }
  return null
}

const UNRESOLVED_START = "⟨"
const UNRESOLVED_END = "⟩"
const UNRESOLVED = /⟨(--[\w-]+)⟩/g

function expandOnce(
  value: string,
  local: LocalProperties,
  tokens: TokenTable,
  depth: number,
): string[] {
  const call = firstVarCall(value)
  if (call === null || depth > MAX_DEPTH) return [value]
  const definitions = definitionsOf(call.name, local, tokens)
  const replacements =
    definitions.length > 0
      ? definitions
      : call.fallback !== undefined
        ? [call.fallback]
        : [`${UNRESOLVED_START}${call.name}${UNRESOLVED_END}`]
  return replacements
    .flatMap((replacement) =>
      expandOnce(value.replace(call.text, replacement), local, tokens, depth + 1),
    )
    .slice(0, MAX_VARIANTS)
}

export function expandVars(
  value: string,
  local: LocalProperties,
  tokens: TokenTable,
): string[] {
  return expandOnce(value, local, tokens, 0).map((variant) =>
    variant.replace(UNRESOLVED, "var($1)"),
  )
}

export function referencedNames(
  value: string,
  local: LocalProperties,
  tokens: TokenTable,
  seen: Set<string> = new Set(),
): Set<string> {
  for (const name of varNames(value)) {
    if (seen.has(name)) continue
    seen.add(name)
    for (const definition of definitionsOf(name, local, tokens))
      referencedNames(definition, local, tokens, seen)
  }
  return seen
}

export function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of value) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else current += char
  }
  if (current.trim() !== "") parts.push(current.trim())
  return parts
}

export function splitWords(value: string): string[] {
  return splitTopLevel(value.replace(/\s+/g, " "), " ")
}
