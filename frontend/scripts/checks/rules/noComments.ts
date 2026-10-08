import { parseScript, parseStyles } from "../parse.ts"
import {
  type Check,
  extensionOf,
  isScript,
  isStyle,
  type SourceFile,
  type Violation,
} from "../types.ts"

const ALLOWED_COMMENT = /^\s*(biome-ignore\s+\S+:\s*\S|@ts-expect-error\s+\S)/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const INLINE_BLOCK = /<(style|script)\b[^>]*>([\s\S]*?)<\/\1>/gi
const HASH_COMMENTED = /\.(sh|envsh|template|conf)$|(^|\/)Dockerfile$/

export function isAllowedComment(value: string): boolean {
  return ALLOWED_COMMENT.test(value)
}

function scriptComments(file: SourceFile): string[] {
  return parseScript(file.path, file.text)
    .comments.map((comment) => comment.value)
    .filter((value) => !isAllowedComment(value))
}

function styleComments(file: SourceFile): string[] {
  const found: string[] = []
  parseStyles(file.text).walkComments((comment) => {
    if (!isAllowedComment(comment.text)) found.push(comment.text)
  })
  return found
}

export function jsonComments(text: string): string[] {
  const found: string[] = []
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === "\\") index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
      found.push(text.slice(index, text.indexOf("\n", index)))
    }
  }
  return found
}

export function hashComments(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line, index) => /^\s*#/.test(line) && !(index === 0 && line.startsWith("#!")))
}

function htmlComments(file: SourceFile): string[] {
  const inline = [...file.text.matchAll(INLINE_BLOCK)].flatMap((match) => {
    const body = match[2] ?? ""
    const kind = (match[1] ?? "").toLowerCase()
    return kind === "style"
      ? styleComments({ path: `${file.path}.css`, text: body })
      : scriptComments({ path: `${file.path}.js`, text: body })
  })
  return [...(file.text.match(HTML_COMMENT) ?? []), ...inline]
}

function commentsOf(file: SourceFile): string[] {
  if (isScript(file.path)) return scriptComments(file)
  if (isStyle(file.path)) return styleComments(file)
  if (HASH_COMMENTED.test(file.path)) return hashComments(file.text)
  if (extensionOf(file.path) === ".html") return htmlComments(file)
  if (extensionOf(file.path) === ".json") return jsonComments(file.text)
  return []
}

export const noComments: Check = {
  id: "no-comments",
  run: (files) =>
    files.flatMap((file): Violation[] =>
      commentsOf(file).map((comment) => ({
        file: file.path,
        message: `comment: ${comment.trim().slice(0, 60)}`,
      })),
    ),
}
