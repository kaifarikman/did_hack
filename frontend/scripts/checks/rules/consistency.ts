import { expandVars, localProperties } from "../cssVars.ts"
import { type AstNode, parseScript, parseStyles, walkAst } from "../parse.ts"
import { type Check, isScript, isStyle, type SourceFile, type Violation } from "../types.ts"
import { literalStrings } from "./texts.ts"

export const SCREEN_SCOPES = ["src/ui/features/", "src/ui/app/"]

const NATIVE_INPUT_TYPES = new Set(["checkbox", "radio", "number", "range"])
const OWN_ROLE_ELEMENTS: Readonly<Record<string, string>> = {
  select: "Select",
  details: "Disclosure",
  dialog: "Dialog",
  button: "Button",
  meter: "Meter",
  progress: "Meter",
}
const OWN_ROLES: Readonly<Record<string, string>> = {
  tablist: "Segmented",
  radiogroup: "RadioGroup",
  switch: "Switch",
  listbox: "Select",
  menu: "Menu",
  tooltip: "Tooltip",
}
const DASH_TEXT = /^\s*(—|–|-|n\/a)\s*$/i
const SECTION_HEADING = /^h[2-6]$/
const SCROLLING = /\b(auto|scroll)\b/
const OWN_SURFACE = /--surface-/
const NO_TOKENS = new Map<string, string>()

type Constants = ReadonlyMap<string, AstNode>

function inScreens(path: string): boolean {
  return SCREEN_SCOPES.some((scope) => path.startsWith(scope))
}

function fileConstants(program: AstNode): Constants {
  const constants = new Map<string, AstNode>()
  walkAst(program, (node) => {
    if (node.type !== "VariableDeclarator") return
    const id = node.id as AstNode | undefined
    const init = node.init as AstNode | null | undefined
    if (id?.type === "Identifier" && init !== null && init !== undefined)
      constants.set(String(id.name), init)
  })
  return constants
}

function constantStrings(node: AstNode | null | undefined, constants: Constants): string[] {
  if (node?.type === "Identifier") {
    const value = constants.get(String(node.name))
    return value === undefined ? [] : constantStrings(value, new Map())
  }
  if (node?.type === "JSXExpressionContainer")
    return constantStrings(node.expression as AstNode, constants)
  return literalStrings(node)
}

interface Attributes {
  readonly values: ReadonlyMap<string, readonly string[]>
}

function attributesOf(node: AstNode, constants: Constants): Attributes {
  const values = new Map<string, string[]>()
  const add = (name: string, found: readonly string[]) =>
    values.set(name, [...(values.get(name) ?? []), ...found])
  for (const item of (node.attributes as readonly AstNode[] | undefined) ?? []) {
    if (item.type === "JSXAttribute") {
      const name = (item.name as { name?: unknown } | undefined)?.name
      if (typeof name === "string") add(name, constantStrings(item.value as AstNode, constants))
    }
    const spread = item.type === "JSXSpreadAttribute" ? (item.argument as AstNode) : null
    if (spread?.type !== "ObjectExpression") continue
    for (const property of (spread.properties as readonly AstNode[] | undefined) ?? []) {
      const key = property.key as AstNode | undefined
      const name = String(key?.name ?? key?.value ?? "")
      add(name, constantStrings(property.value as AstNode, constants))
    }
  }
  return { values }
}

export function elementProblem(tag: string, attributes: Attributes): string | null {
  const replacement = OWN_ROLE_ELEMENTS[tag]
  if (replacement !== undefined) return `<${tag}> instead of ${replacement}`
  if (SECTION_HEADING.test(tag)) return `<${tag}> instead of Card title`
  const as = attributes.values.get("as") ?? []
  if (tag === "Eyebrow" && as.some((value) => SECTION_HEADING.test(value)))
    return "Eyebrow heading instead of Card title"
  const native = (attributes.values.get("type") ?? []).find((type) =>
    NATIVE_INPUT_TYPES.has(type),
  )
  if (tag === "input" && native !== undefined)
    return `<input type=${native}> instead of a shared control`
  const role = (attributes.values.get("role") ?? []).find(
    (item) => OWN_ROLES[item] !== undefined,
  )
  return role === undefined ? null : `role=${role} instead of ${OWN_ROLES[role]}`
}

function createdTag(node: AstNode, constants: Constants): string | null {
  const callee = node.callee as AstNode | undefined
  const name = callee?.name ?? (callee?.property as AstNode | undefined)?.name
  if (name !== "createElement") return null
  const [first] = (node.arguments as readonly AstNode[] | undefined) ?? []
  return constantStrings(first, constants)[0] ?? null
}

function nodeProblem(node: AstNode, constants: Constants): string | null {
  if (node.type === "CallExpression") {
    const created = createdTag(node, constants)
    return created === null ? null : elementProblem(created, { values: new Map() })
  }
  const tag = (node.name as { name?: unknown } | undefined)?.name
  if (node.type !== "JSXOpeningElement" || typeof tag !== "string") return null
  return elementProblem(tag, attributesOf(node, constants))
}

function dashTexts(
  node: AstNode,
  constants: Constants,
  attributeValues: ReadonlySet<AstNode>,
): string[] {
  if (node.type === "JSXText") return [String(node.value)]
  if (node.type === "JSXExpressionContainer" && !attributeValues.has(node))
    return constantStrings(node, constants)
  return []
}

function scriptProblems(file: SourceFile): string[] {
  const problems: string[] = []
  const program = parseScript(file.path, file.text).program
  const constants = fileConstants(program)
  const attributeValues = new Set<AstNode>()
  walkAst(program, (node) => {
    if (node.type === "JSXAttribute" && node.value !== null)
      attributeValues.add(node.value as AstNode)
  })
  walkAst(program, (node) => {
    const problem = nodeProblem(node, constants)
    if (problem !== null) problems.push(problem)
    if (dashTexts(node, constants, attributeValues).some((text) => DASH_TEXT.test(text)))
      problems.push("manual dash instead of NoValue")
  })
  return problems
}

function styleProblems(file: SourceFile): string[] {
  const problems: string[] = []
  const local = localProperties(file.text)
  const root = parseStyles(file.text)
  root.walkDecls((declaration) => {
    const variants = expandVars(declaration.value, local, NO_TOKENS)
    if (declaration.prop === "text-transform" && variants.includes("uppercase"))
      problems.push("uppercase instead of Eyebrow")
    if (
      /^overflow(-[xy]|-block|-inline)?$/.test(declaration.prop) &&
      variants.some((value) => SCROLLING.test(value))
    )
      problems.push("scrolling container instead of ScrollArea")
  })
  root.walkRules((rule) => {
    let rounded = false
    let surface = false
    let padded = false
    rule.walkDecls((declaration) => {
      const variants = expandVars(declaration.value, local, NO_TOKENS).join(" ")
      if (declaration.prop.endsWith("radius") && /--radius-(inner|card)/.test(variants))
        rounded = true
      if (/^background(-color)?$/.test(declaration.prop) && OWN_SURFACE.test(variants))
        surface = true
      if (/^padding/.test(declaration.prop) && declaration.value !== "0") padded = true
    })
    if (rounded && surface && padded)
      problems.push(`${rule.selector} draws its own card surface`)
  })
  return problems
}

export const consistency: Check = {
  id: "consistency",
  run: (files) =>
    files
      .filter((file) => inScreens(file.path))
      .flatMap((file) => {
        const problems =
          isScript(file.path) && /\.[jt]sx$/.test(file.path)
            ? scriptProblems(file)
            : isStyle(file.path)
              ? styleProblems(file)
              : []
        return problems.map((message): Violation => ({ file: file.path, message }))
      }),
}
