import { type AstNode, parseScript } from "../parse.ts"
import { resolveSpecifier } from "../paths.ts"
import { type Check, isScript, type SourceFile, type Violation } from "../types.ts"

const MODULE_NODES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
])
const FEATURE = /^src\/ui\/features\/([^/]+)\//

export type Layer =
  | "domain"
  | "application"
  | "adapters"
  | "shared"
  | "feature"
  | "app"
  | "root"

export function layerOf(path: string): Layer {
  if (path.startsWith("src/domain/")) return "domain"
  if (path.startsWith("src/application/")) return "application"
  if (path.startsWith("src/adapters/")) return "adapters"
  if (path.startsWith("src/ui/shared/")) return "shared"
  if (path.startsWith("src/ui/features/")) return "feature"
  if (path.startsWith("src/ui/app/")) return "app"
  return "root"
}

const ALLOWED: Readonly<Record<Layer, ReadonlySet<Layer>>> = {
  domain: new Set(["domain"]),
  application: new Set(["domain", "application"]),
  adapters: new Set(["domain", "application", "adapters"]),
  shared: new Set(["domain", "application", "shared"]),
  feature: new Set(["domain", "application", "shared", "feature"]),
  app: new Set(["domain", "application", "adapters", "shared", "feature", "app"]),
  root: new Set(["domain", "application", "adapters", "shared", "feature", "app", "root"]),
}
const PURE_LAYERS: ReadonlySet<Layer> = new Set(["domain", "application"])

export function moduleSpecifiers(file: SourceFile): string[] {
  const body = parseScript(file.path, file.text).program.body as readonly AstNode[]
  return body.flatMap((node) => {
    if (!MODULE_NODES.has(node.type)) return []
    const source = node.source as { value?: unknown } | null | undefined
    return typeof source?.value === "string" ? [source.value] : []
  })
}

export function layerProblem(
  from: string,
  specifier: string,
  target: string | null,
): string | null {
  const source = layerOf(from)
  const bare = target === null && !specifier.startsWith(".") && !specifier.startsWith("@/")
  if (bare) return PURE_LAYERS.has(source) ? `${source} imports package ${specifier}` : null
  if (target === null) return null
  const destination = layerOf(target)
  if (!ALLOWED[source].has(destination)) return `${source} imports ${destination}: ${target}`
  const ownFeature = FEATURE.exec(from)?.[1]
  const otherFeature = FEATURE.exec(target)?.[1]
  if (source === "feature" && otherFeature !== undefined && otherFeature !== ownFeature)
    return `feature ${ownFeature} imports feature ${otherFeature}`
  return null
}

export const layers: Check = {
  id: "layers",
  run: (files) => {
    const sources = files.filter((file) => file.path.startsWith("src/"))
    const known = new Set(sources.map((file) => file.path))
    return sources
      .filter((file) => isScript(file.path))
      .flatMap((file) =>
        moduleSpecifiers(file).flatMap((specifier): Violation[] => {
          const target = resolveSpecifier(file.path, specifier, known)
          const problem = layerProblem(file.path, specifier, target)
          return problem === null ? [] : [{ file: file.path, message: problem }]
        }),
      )
  },
}
