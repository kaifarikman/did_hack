export interface SourceFile {
  readonly path: string
  readonly text: string
}

export interface Violation {
  readonly file: string
  readonly message: string
  readonly weight?: number
}

export interface Check {
  readonly id: string
  readonly run: (files: readonly SourceFile[]) => readonly Violation[]
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot === -1 ? "" : path.slice(dot)
}

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

export const SCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
])

export const TOKENS_DIR = "src/ui/shared/styles/tokens/"

export const STYLES_DIR = "src/ui/shared/styles/"

export const FIXTURE_EXAMPLES_DIR = "src/adapters/fixture/examples/"

export function isScript(path: string): boolean {
  return SCRIPT_EXTENSIONS.has(extensionOf(path))
}

export function isStyle(path: string): boolean {
  return path.endsWith(".css")
}

export function isTest(path: string): boolean {
  return /\.test\.tsx?$/.test(path)
}

export function isSource(path: string): boolean {
  return path.startsWith("src/")
}
