import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = resolve(process.cwd(), "src")
const LOCALES = join(ROOT, "ui/shared/i18n/locales/en")
const SHARED_NAMESPACES = ["common", "errors"] as const
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const TEMPLATE_PREFIX = /`(?:(\w+):)?([\w.]+)\$\{/g

type Tree = { readonly [key: string]: unknown }

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? leafKeys(value as Tree, `${prefix}${key}.`)
      : [`${prefix}${key}`.replace(PLURAL_SUFFIX, "")],
  )
}

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry) ? [readFileSync(path, "utf8")] : []
  })
}

const code = sources(ROOT).join("\n")
const prefixes = [...code.matchAll(TEMPLATE_PREFIX)].map(
  (match) => `${match[1] ?? "common"}:${match[2]}`,
)

function isUsed(namespace: string, key: string): boolean {
  const full = `${namespace}:${key}`
  if (code.includes(`"${full}"`) || code.includes(`\`${full}\``)) return true
  if (namespace === "common" && code.includes(`"${key}"`)) return true
  return prefixes.some((prefix) => full.startsWith(prefix))
}

describe("shared dictionaries", () => {
  it.each(SHARED_NAMESPACES)("has no unused keys in %s", (namespace) => {
    const tree = JSON.parse(readFileSync(join(LOCALES, `${namespace}.json`), "utf8")) as Tree
    const unused = [...new Set(leafKeys(tree))].filter((key) => !isUsed(namespace, key))
    expect(unused).toEqual([])
  })
})
