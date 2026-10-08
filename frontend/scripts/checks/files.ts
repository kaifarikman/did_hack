import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import type { SourceFile } from "./types.ts"

export const SCANNED_DIRECTORIES = ["src", "tests", "scripts", "e2e", "docker", "public"]
const ROOT_FILE =
  /^(index\.html|Dockerfile|[\w.-]+\.config\.ts|biome\.json|package\.json|tsconfig[\w.-]*\.json)$/
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"])
const TEXT_FILE =
  /(\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|css|html|json|sh|envsh|template|conf)|^Dockerfile)$/
const REQUIRED_DIRECTORY = "src"

export class MissingSourcesError extends Error {
  constructor(root: string) {
    super(`rules: ${root} has no ${REQUIRED_DIRECTORY}/ with sources, run from the frontend`)
    this.name = "MissingSourcesError"
  }
}

function walk(root: string, directory: string, found: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) walk(root, absolute, found)
    else if (TEXT_FILE.test(entry)) found.push(relative(root, absolute).split(sep).join("/"))
  }
}

export function frontendRoot(scriptDirectory: string): string {
  return resolve(scriptDirectory, "..", "..")
}

export function collectFiles(root: string): SourceFile[] {
  const paths: string[] = []
  for (const directory of SCANNED_DIRECTORIES) {
    const absolute = join(root, directory)
    if (existsSync(absolute)) walk(root, absolute, paths)
  }
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (ROOT_FILE.test(entry) && statSync(join(root, entry)).isFile()) paths.push(entry)
    }
  }
  if (!paths.some((path) => path.startsWith(`${REQUIRED_DIRECTORY}/`)))
    throw new MissingSourcesError(root)
  return paths.sort().map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }))
}
