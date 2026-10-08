import { directoryOf } from "./types.ts"

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]

export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split("/")) {
    if (part === "..") parts.pop()
    else if (part !== "." && part !== "") parts.push(part)
  }
  return parts.join("/")
}

export function resolveSpecifier(
  from: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith(".")
      ? normalizePath(`${directoryOf(from)}/${specifier}`)
      : null
  if (base === null) return null
  const bases = [base, base.replace(/\.(m|c)?jsx?$/, "")]
  return (
    bases
      .flatMap((candidate) => RESOLVE_SUFFIXES.map((suffix) => `${candidate}${suffix}`))
      .find((path) => known.has(path)) ?? null
  )
}
