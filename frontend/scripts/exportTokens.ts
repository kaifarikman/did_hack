import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const TOKEN_FILES = [
  "palette.css",
  "semantic.css",
  "typography.css",
  "space.css",
  "radius.css",
  "elevation.css",
  "motion.css",
  "keyframes.css",
] as const

export const FONT_FILES = [
  "Inter-Regular.woff2",
  "Inter-Medium.woff2",
  "Inter-SemiBold.woff2",
  "InterDisplay-Regular.woff2",
  "OFL.txt",
] as const

export interface TokenSource {
  readonly name: string
  readonly text: string
}

const COMMENT = /\/\*[\s\S]*?\*\//g
const ABSOLUTE_FONT_URL = /url\("\/fonts\//g

export function buildTokenCss(sources: readonly TokenSource[]): string {
  const ordered = TOKEN_FILES.map((name) => sources.find((source) => source.name === name))
  const missing = TOKEN_FILES.filter((_, index) => ordered[index] === undefined)
  if (missing.length > 0) throw new Error(`missing token files: ${missing.join(", ")}`)
  return `${ordered
    .map((source) =>
      (source?.text ?? "")
        .replace(COMMENT, "")
        .replace(ABSOLUTE_FONT_URL, 'url("fonts/')
        .trim(),
    )
    .join("\n\n")}\n`
}

export function exportTokens(frontendRoot: string, targetDir: string): string {
  const tokensDir = join(frontendRoot, "src", "ui", "shared", "styles", "tokens")
  const sources = TOKEN_FILES.map((name) => ({
    name,
    text: readFileSync(join(tokensDir, name), "utf8"),
  }))
  const css = buildTokenCss(sources)
  mkdirSync(join(targetDir, "fonts"), { recursive: true })
  writeFileSync(join(targetDir, "tokens.css"), css)
  for (const font of FONT_FILES) {
    copyFileSync(join(frontendRoot, "public", "fonts", font), join(targetDir, "fonts", font))
  }
  return css
}

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportTokens(frontendRoot, resolve(frontendRoot, "..", "presentation"))
  process.stdout.write(`tokens exported to ${resolve(frontendRoot, "..", "presentation")}\n`)
}
