import postcss from "postcss"
import { parseSync } from "rolldown/utils"

export interface ScriptComment {
  readonly type: string
  readonly value: string
}

export interface AstNode {
  readonly type: string
  readonly [key: string]: unknown
}

export interface ParsedScript {
  readonly program: AstNode
  readonly comments: readonly ScriptComment[]
}

export function parseScript(path: string, text: string): ParsedScript {
  const result = parseSync(path, text)
  return {
    program: result.program as unknown as AstNode,
    comments: result.comments as readonly ScriptComment[],
  }
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof (value as AstNode).type === "string"
  )
}

export function walkAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) if (isNode(child)) walkAst(child, visit)
  }
}

export function parseStyles(text: string): postcss.Root {
  return postcss.parse(text)
}

export interface StyleDeclaration {
  readonly prop: string
  readonly value: string
  readonly selector: string
}

export function styleDeclarations(text: string): StyleDeclaration[] {
  const declarations: StyleDeclaration[] = []
  parseStyles(text).walkDecls((declaration) => {
    const parent = declaration.parent
    const selector = parent?.type === "rule" ? (parent as postcss.Rule).selector : ""
    declarations.push({ prop: declaration.prop, value: declaration.value, selector })
  })
  return declarations
}
