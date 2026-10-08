import { literalKinds } from "../literals.ts"
import { type AstNode, parseScript, walkAst } from "../parse.ts"
import type { SourceFile } from "../types.ts"
import { literalStrings } from "./texts.ts"

const TOKEN_READERS = new Set(["motionMs", "readToken", "readEasing", "readPixels"])
const PROPERTY_METHODS = new Set(["setProperty", "getPropertyValue", "removeProperty"])
const CUSTOM_PROPERTY = /^--[\w-]+$/

function memberName(node: AstNode | undefined): string {
  const property = node?.property as AstNode | undefined
  return String(property?.name ?? property?.value ?? "")
}

function keyName(property: AstNode): string {
  const key = property.key as AstNode | undefined
  return String(key?.name ?? key?.value ?? "")
}

function unwrap(node: AstNode | undefined): AstNode | undefined {
  if (node?.type === "TSAsExpression" || node?.type === "TSSatisfiesExpression")
    return unwrap(node.expression as AstNode)
  if (node?.type === "JSXExpressionContainer") return unwrap(node.expression as AstNode)
  return node
}

function isStyleTarget(node: AstNode | undefined): boolean {
  const object = node?.object as AstNode | undefined
  return node?.type === "MemberExpression" && memberName(object) === "style"
}

function calleeName(node: AstNode): string {
  const callee = node.callee as AstNode | undefined
  return callee?.type === "Identifier" ? String(callee.name) : memberName(callee)
}

function literalIssues(where: string, node: AstNode | undefined): string[] {
  return literalStrings(node).flatMap((text) =>
    literalKinds(text).map((kind) => `${kind} in ${where}: ${text.slice(0, 40)}`),
  )
}

function inlineStyleProblems(node: AstNode): string[] {
  const object = unwrap(node.value as AstNode)
  if (object?.type !== "ObjectExpression") return []
  return ((object.properties as readonly AstNode[] | undefined) ?? []).flatMap((property) => {
    if (property.type !== "Property") return []
    const name = keyName(property)
    const value = unwrap(property.value as AstNode)
    if (CUSTOM_PROPERTY.test(name)) return literalIssues(`inline ${name}`, value)
    const literal = value?.type === "Literal" || value?.type === "TemplateLiteral"
    return literal && value.value !== 0 ? [`inline style literal ${name}`] : []
  })
}

function attributeName(node: AstNode): string {
  const name = node.name as { name?: unknown } | undefined
  return typeof name?.name === "string" ? name.name : ""
}

function nodeProblems(node: AstNode): string[] {
  if (node.type === "JSXAttribute" && attributeName(node) === "style")
    return inlineStyleProblems(node)
  if (node.type === "AssignmentExpression" && isStyleTarget(node.left as AstNode))
    return literalIssues(`style.${memberName(node.left as AstNode)}`, node.right as AstNode)
  if (node.type === "CallExpression" && calleeName(node) === "setProperty") {
    const [name, value] = (node.arguments as readonly AstNode[] | undefined) ?? []
    return literalIssues(`setProperty(${literalStrings(name).join("")})`, value)
  }
  return []
}

export function scriptStyleLiterals(file: SourceFile): string[] {
  const found: string[] = []
  walkAst(parseScript(file.path, file.text).program, (node) => {
    found.push(...nodeProblems(node))
  })
  return found
}

export function scriptTokenNames(file: SourceFile): string[] {
  const names: string[] = []
  walkAst(parseScript(file.path, file.text).program, (node) => {
    if (node.type !== "CallExpression" || !TOKEN_READERS.has(calleeName(node))) return
    const [first] = (node.arguments as readonly AstNode[] | undefined) ?? []
    for (const text of literalStrings(first)) if (CUSTOM_PROPERTY.test(text)) names.push(text)
  })
  return names
}

export function scriptCustomProperties(file: SourceFile): string[] {
  const names: string[] = []
  walkAst(parseScript(file.path, file.text).program, (node) => {
    if (node.type === "Property" && CUSTOM_PROPERTY.test(keyName(node)))
      names.push(keyName(node))
    if (node.type !== "CallExpression" || !PROPERTY_METHODS.has(calleeName(node))) return
    const [first] = (node.arguments as readonly AstNode[] | undefined) ?? []
    for (const text of literalStrings(first)) if (CUSTOM_PROPERTY.test(text)) names.push(text)
  })
  return names
}
