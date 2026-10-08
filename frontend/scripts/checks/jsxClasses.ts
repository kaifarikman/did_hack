import { type AstNode, parseScript, walkAst } from "./parse.ts"
import { normalizePath } from "./paths.ts"
import { directoryOf, type SourceFile } from "./types.ts"

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"])
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "option",
  "menuitem",
  "menuitemradio",
  "menuitemcheckbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
])
const HANDLERS = /^onClick$/

export type ModuleClasses = ReadonlyMap<string, ReadonlySet<string>>

function styleImports(program: AstNode, path: string): Map<string, string> {
  const imports = new Map<string, string>()
  for (const node of program.body as readonly AstNode[]) {
    if (node.type !== "ImportDeclaration") continue
    const source = String((node.source as { value?: unknown }).value ?? "")
    if (!source.endsWith(".module.css") || !source.startsWith(".")) continue
    for (const specifier of (node.specifiers as readonly AstNode[] | undefined) ?? []) {
      const local = (specifier.local as { name?: unknown } | undefined)?.name
      if (typeof local === "string")
        imports.set(local, normalizePath(`${directoryOf(path)}/${source}`))
    }
  }
  return imports
}

function attributes(node: AstNode): readonly AstNode[] {
  return (node.attributes as readonly AstNode[] | undefined) ?? []
}

function attributeName(node: AstNode): string {
  const name = node.name as { name?: unknown } | undefined
  return typeof name?.name === "string" ? name.name : ""
}

function isInteractive(node: AstNode): boolean {
  const tag = (node.name as { name?: unknown } | undefined)?.name
  if (typeof tag === "string" && INTERACTIVE_TAGS.has(tag)) return true
  return attributes(node).some((attribute) => {
    const name = attributeName(attribute)
    if (HANDLERS.test(name)) return true
    const value = attribute.value as AstNode | null | undefined
    return (
      name === "role" && value?.type === "Literal" && INTERACTIVE_ROLES.has(String(value.value))
    )
  })
}

function memberClasses(
  node: AstNode,
  imports: ReadonlyMap<string, string>,
): [string, string][] {
  const found: [string, string][] = []
  walkAst(node, (child) => {
    if (child.type !== "MemberExpression" && child.type !== "StaticMemberExpression") return
    const object = child.object as AstNode | undefined
    const property = child.property as AstNode | undefined
    const module = object?.type === "Identifier" ? imports.get(String(object.name)) : undefined
    const name = property?.name ?? property?.value
    if (module !== undefined && typeof name === "string") found.push([module, name])
  })
  return found
}

export function interactiveModuleClasses(files: readonly SourceFile[]): ModuleClasses {
  const classes = new Map<string, Set<string>>()
  for (const file of files.filter((item) => item.path.endsWith(".tsx"))) {
    const program = parseScript(file.path, file.text).program
    const imports = styleImports(program, file.path)
    if (imports.size === 0) continue
    walkAst(program, (node) => {
      if (node.type !== "JSXOpeningElement" || !isInteractive(node)) return
      const className = attributes(node).find((item) => attributeName(item) === "className")
      if (className === undefined) return
      for (const [module, name] of memberClasses(className, imports))
        classes.set(module, new Set([...(classes.get(module) ?? []), name]))
    })
  }
  return classes
}
