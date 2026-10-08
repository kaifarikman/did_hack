import { type AstNode, parseScript } from "../parse.ts"
import { resolveSpecifier } from "../paths.ts"
import { type Check, isScript, type SourceFile, type Violation } from "../types.ts"

const MODULE_NODES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
])

export function runtimeImports(file: SourceFile): string[] {
  const body = parseScript(file.path, file.text).program.body as readonly AstNode[]
  return body.flatMap((node) => {
    if (!MODULE_NODES.has(node.type)) return []
    if (node.importKind === "type" || node.exportKind === "type") return []
    const source = node.source as { value?: unknown } | null | undefined
    return typeof source?.value === "string" ? [source.value] : []
  })
}

export function importGraph(files: readonly SourceFile[]): Map<string, string[]> {
  const scripts = files.filter((file) => file.path.startsWith("src/") && isScript(file.path))
  const known = new Set(scripts.map((file) => file.path))
  const graph = new Map<string, string[]>()
  for (const file of scripts) {
    const targets = runtimeImports(file)
      .map((specifier) => resolveSpecifier(file.path, specifier, known))
      .filter((target): target is string => target !== null)
    graph.set(file.path, targets)
  }
  return graph
}

function reachableFrom(
  graph: ReadonlyMap<string, readonly string[]>,
  start: string,
): Set<string> {
  const reached = new Set<string>()
  const pending = [...(graph.get(start) ?? [])]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (reached.has(node)) continue
    reached.add(node)
    pending.push(...(graph.get(node) ?? []))
  }
  return reached
}

export function cycleGroups(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const nodes = [...graph.keys()].sort()
  const reach = new Map(nodes.map((node) => [node, reachableFrom(graph, node)]))
  const grouped = new Set<string>()
  const groups: string[][] = []
  for (const node of nodes) {
    const reachable = reach.get(node) ?? new Set<string>()
    if (grouped.has(node) || !reachable.has(node)) continue
    const group = nodes.filter((other) => reachable.has(other) && reach.get(other)?.has(node))
    for (const member of group) grouped.add(member)
    groups.push(group)
  }
  return groups
}

export const importCycles: Check = {
  id: "import-cycles",
  run: (files) =>
    cycleGroups(importGraph(files)).map(
      (group): Violation => ({
        file: group[0] ?? "",
        message: `import cycle: ${group.join(" -> ")}`,
      }),
    ),
}
