import { parseStyles } from "../parse.ts"
import { resolveSpecifier } from "../paths.ts"
import {
  type Check,
  directoryOf,
  isScript,
  isSource,
  isStyle,
  type SourceFile,
  STYLES_DIR,
  type Violation,
} from "../types.ts"
import { runtimeImports } from "./importCycles.ts"

const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g
const STYLES_MEMBER = /styles\.([_a-zA-Z]\w*)|styles\[\s*"([\w-]+)"\s*\]/g

function classesOf(text: string): Set<string> {
  const classes = new Set<string>()
  parseStyles(text).walkRules((rule) => {
    for (const match of rule.selector.matchAll(CLASS_NAME)) classes.add(match[1] ?? "")
  })
  return classes
}

function cssImportTargets(file: SourceFile, known: ReadonlySet<string>): string[] {
  const targets: string[] = []
  parseStyles(file.text).walkAtRules("import", (rule) => {
    const specifier = rule.params
      .replace(/^url\(|\)$/g, "")
      .replace(/["']/g, "")
      .trim()
    const target = resolveSpecifier(file.path, specifier, known)
    if (target !== null) targets.push(target)
  })
  return targets
}

const COMPOSES_FROM = /^(.+?)\s+from\s+["']([^"']+)["']$/

function moduleSyntaxProblems(module: SourceFile): string[] {
  const problems: string[] = []
  const root = parseStyles(module.text)
  root.walkAtRules("import", (rule) => {
    problems.push(`@import ${rule.params} inside a CSS module`)
  })
  root.walkRules(/:global/, (rule) => {
    problems.push(`${rule.selector} escapes the module with :global`)
  })
  return problems
}

function composedClasses(styles: readonly SourceFile[]): Map<string, Set<string>> {
  const known = new Set(styles.map((file) => file.path))
  const composed = new Map<string, Set<string>>()
  for (const file of styles) {
    parseStyles(file.text).walkDecls("composes", (declaration) => {
      const match = COMPOSES_FROM.exec(declaration.value.trim())
      const target =
        match === null ? file.path : resolveSpecifier(file.path, match[2] ?? "", known)
      const names = (match === null ? declaration.value : (match[1] ?? "")).split(/\s+/)
      if (target === null) return
      composed.set(target, new Set([...(composed.get(target) ?? []), ...names]))
    })
  }
  return composed
}

function moduleProblems(
  module: SourceFile,
  importers: readonly SourceFile[],
  composed: ReadonlySet<string>,
): string[] {
  const shared = module.path.startsWith(STYLES_DIR)
  if (importers.length === 0 && composed.size === 0) return ["module is not imported"]
  const foreign = shared
    ? []
    : importers.filter((importer) => directoryOf(importer.path) !== directoryOf(module.path))
  const used = new Set([
    ...composed,
    ...importers.flatMap((importer) =>
      [...importer.text.matchAll(STYLES_MEMBER)].map((match) => match[1] ?? match[2] ?? ""),
    ),
  ])
  return [
    ...moduleSyntaxProblems(module),
    ...foreign.map((importer) => `imported outside its component by ${importer.path}`),
    ...[...classesOf(module.text)]
      .filter((name) => !used.has(name))
      .map((name) => `unused class .${name}`),
  ]
}

export const cssModules: Check = {
  id: "css-modules",
  run: (files) => {
    const styles = files.filter((file) => isSource(file.path) && isStyle(file.path))
    const scripts = files.filter((file) => isSource(file.path) && isScript(file.path))
    const known = new Set(styles.map((file) => file.path))
    const importersOf = new Map<string, SourceFile[]>()
    for (const script of scripts) {
      for (const specifier of runtimeImports(script)) {
        const target = resolveSpecifier(script.path, specifier, known)
        if (target !== null)
          importersOf.set(target, [...(importersOf.get(target) ?? []), script])
      }
    }
    const composed = composedClasses(styles)
    const cssImports = new Set(styles.flatMap((file) => cssImportTargets(file, known)))
    return styles.flatMap((file): Violation[] => {
      if (!file.path.endsWith(".module.css")) {
        const reachable =
          file.path === GLOBAL_STYLESHEET ||
          cssImports.has(file.path) ||
          importersOf.has(file.path)
        if (file.path.startsWith(STYLES_DIR))
          return reachable ? [] : [{ file: file.path, message: "stylesheet is not imported" }]
        return [{ file: file.path, message: "global stylesheet outside ui/shared/styles" }]
      }
      const problems = moduleProblems(
        file,
        importersOf.get(file.path) ?? [],
        composed.get(file.path) ?? new Set(),
      )
      return problems.map((message) => ({ file: file.path, message }))
    })
  },
}

export const GLOBAL_STYLESHEET = `${STYLES_DIR}global.css`
export const STYLES_ENTRY = "src/main.tsx"

export const globalStyles: Check = {
  id: "global-styles",
  run: (files) => {
    const known = new Set(
      files
        .filter((file) => isSource(file.path) && isStyle(file.path))
        .map((file) => file.path),
    )
    const found: Violation[] = []
    let entries = 0
    for (const script of files.filter((file) => isSource(file.path) && isScript(file.path))) {
      for (const specifier of runtimeImports(script)) {
        const target = resolveSpecifier(script.path, specifier, known)
        if (target === null || !target.startsWith(STYLES_DIR) || target.endsWith(".module.css"))
          continue
        if (target === GLOBAL_STYLESHEET && script.path === STYLES_ENTRY) entries += 1
        else found.push({ file: script.path, message: `imports global stylesheet ${target}` })
      }
    }
    if (known.has(GLOBAL_STYLESHEET) && entries !== 1)
      found.push({
        file: STYLES_ENTRY,
        message: "global.css must be imported here exactly once",
      })
    return found
  },
}
