import { type AstNode, parseScript, walkAst } from "../parse.ts"
import { type Check, isScript, type SourceFile, type Violation } from "../types.ts"
import { runtimeImports } from "./importCycles.ts"

export const ICON_REGISTRY = "src/ui/shared/ui/icon/icons.ts"
const ICON_PACKAGE = "lucide-react"

export function canonicalGlyph(name: string): string {
  return name.replace(/^Lucide(?=[A-Z])/, "").replace(/(?<=.)Icon$/, "")
}

function importedNames(program: AstNode): Map<string, string> {
  const names = new Map<string, string>()
  for (const node of program.body as readonly AstNode[]) {
    if (node.type !== "ImportDeclaration") continue
    if (!String((node.source as { value?: unknown }).value ?? "").startsWith(ICON_PACKAGE))
      continue
    for (const specifier of (node.specifiers as readonly AstNode[] | undefined) ?? []) {
      const local = (specifier.local as AstNode | undefined)?.name
      const imported = (specifier.imported as AstNode | undefined)?.name ?? local
      if (typeof local === "string") names.set(local, String(imported))
    }
  }
  return names
}

function registryGlyphs(registry: SourceFile): string[] {
  const program = parseScript(registry.path, registry.text).program
  const imported = importedNames(program)
  const glyphs: string[] = []
  walkAst(program, (node) => {
    const value = node.type === "Property" ? (node.value as AstNode | undefined) : undefined
    if (value?.type !== "Identifier") return
    const local = String(value.name)
    if (imported.has(local)) glyphs.push(canonicalGlyph(imported.get(local) ?? local))
  })
  return glyphs
}

function importsIconPackage(file: SourceFile): boolean {
  return runtimeImports(file).some(
    (specifier) => specifier === ICON_PACKAGE || specifier.startsWith(`${ICON_PACKAGE}/`),
  )
}

export const iconAlias: Check = {
  id: "icon-alias",
  run: (files) => {
    const found: Violation[] = []
    for (const file of files.filter(
      (item) => item.path.startsWith("src/") && isScript(item.path),
    )) {
      if (file.path !== ICON_REGISTRY && importsIconPackage(file))
        found.push({
          file: file.path,
          message: `${ICON_PACKAGE} imported outside the icon registry`,
        })
    }
    const registry = files.find((file) => file.path === ICON_REGISTRY)
    if (registry === undefined) return found
    if (runtimeImports(registry).some((specifier) => specifier.startsWith(`${ICON_PACKAGE}/`)))
      found.push({
        file: ICON_REGISTRY,
        message: "icons must come from the static package entry",
      })
    const glyphs = registryGlyphs(registry)
    const repeated = glyphs.filter((glyph, index) => glyphs.indexOf(glyph) !== index)
    for (const glyph of new Set(repeated))
      found.push({ file: ICON_REGISTRY, message: `${glyph} has several names` })
    return found
  },
}
