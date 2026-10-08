import { parseStyles } from "../parse.ts"
import { resolveToken, type TokenTable, tokenTable } from "../tokens.ts"
import {
  type Check,
  isSource,
  isStyle,
  type SourceFile,
  TOKENS_DIR,
  type Violation,
} from "../types.ts"

export const DUPLICATE_THRESHOLD = 3

const LAYOUT_GLUE = new Set([
  "display",
  "position",
  "content",
  "align-items",
  "align-self",
  "justify-content",
  "flex",
  "flex-direction",
  "gap",
  "inset",
  "inset-inline",
  "inset-block",
  "min-inline-size",
  "composes",
])
const SHORTHAND_ALIASES: Readonly<Record<string, string>> = {
  background: "background-color",
  "grid-gap": "gap",
}
const SINGLE_VALUE = /^(var\(--[\w-]+\)|#[0-9a-f]{3,8}|transparent|currentColor)$/i
const VAR_ONLY = /var\((--[\w-]+)\)/g

interface RuleBlock {
  readonly file: string
  readonly selector: string
  readonly declarations: ReadonlySet<string>
}

function finalAlias(name: string, tokens: TokenTable): string {
  let current = name
  for (let depth = 0; depth < 8; depth += 1) {
    const next = /^var\((--[\w-]+)\)$/.exec(tokens.get(current) ?? "")?.[1]
    if (next === undefined) return current
    current = next
  }
  return current
}

export function normalizedDeclaration(prop: string, value: string, tokens: TokenTable): string {
  const compact = value.replace(/\s+/g, " ").trim()
  const property = SINGLE_VALUE.test(compact) ? (SHORTHAND_ALIASES[prop] ?? prop) : prop
  const resolved = compact.replace(VAR_ONLY, (_match, name: string) => {
    const alias = finalAlias(name, tokens)
    return resolveToken(tokens, alias) === null ? `var(${name})` : `var(${alias})`
  })
  return `${property}: ${resolved}`
}

function ruleBlocks(file: SourceFile, tokens: TokenTable): RuleBlock[] {
  const bySelector = new Map<string, Set<string>>()
  parseStyles(file.text).walkRules((rule) => {
    const context =
      rule.parent?.type === "atrule" ? `@${(rule.parent as { params?: string }).params} ` : ""
    const key = `${context}${rule.selector}`
    const declarations = bySelector.get(key) ?? new Set<string>()
    rule.each((node) => {
      if (node.type !== "decl" || node.prop.startsWith("--") || LAYOUT_GLUE.has(node.prop))
        return
      declarations.add(normalizedDeclaration(node.prop, node.value, tokens))
    })
    bySelector.set(key, declarations)
  })
  return [...bySelector]
    .filter(([, declarations]) => declarations.size >= DUPLICATE_THRESHOLD)
    .map(([selector, declarations]) => ({ file: file.path, selector, declarations }))
}

export const cssDuplicates: Check = {
  id: "css-duplicates",
  run: (files) => {
    const tokens = tokenTable(files)
    const blocks = files
      .filter(
        (file) =>
          isSource(file.path) && isStyle(file.path) && !file.path.startsWith(TOKENS_DIR),
      )
      .flatMap((file) => ruleBlocks(file, tokens))
    const found: Violation[] = []
    blocks.forEach((block, index) => {
      for (const earlier of blocks.slice(0, index)) {
        const shared = [...block.declarations].filter((item) => earlier.declarations.has(item))
        if (shared.length < DUPLICATE_THRESHOLD) continue
        found.push({
          file: block.file,
          message: `${block.selector} repeats ${shared.length} declarations of ${earlier.file} ${earlier.selector}`,
        })
      }
    })
    return found
  },
}
