import { type Check, extensionOf, FIXTURE_EXAMPLES_DIR, type Violation } from "../types.ts"

export const MAX_LINES = 250

const MEASURED = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".sh",
])

export function lineCount(text: string): number {
  const lines = text.split(/\r?\n/)
  return lines.at(-1) === "" ? lines.length - 1 : lines.length
}

export const fileLength: Check = {
  id: "file-length",
  run: (files) =>
    files.flatMap((file): Violation[] => {
      if (!MEASURED.has(extensionOf(file.path))) return []
      if (file.path.startsWith(FIXTURE_EXAMPLES_DIR)) return []
      const lines = lineCount(file.text)
      if (lines <= MAX_LINES) return []
      return [
        {
          file: file.path,
          message: `${lines} lines > ${MAX_LINES}`,
          weight: lines - MAX_LINES,
        },
      ]
    }),
}
