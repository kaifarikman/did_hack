import { readdirSync, readFileSync } from "node:fs"

type Tree = { readonly [key: string]: string | Tree }

export const F2_NAMESPACES = ["mission", "map", "research", "journal", "team", "demo"] as const
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const ROOT = new URL("../../../src/ui/shared/i18n/locales/", import.meta.url)

export function readDictionary(locale: "ru" | "en", namespace: string): Tree {
  return JSON.parse(readFileSync(new URL(`${locale}/${namespace}.json`, ROOT), "utf8")) as Tree
}

export function localeFiles(locale: "ru" | "en"): string[] {
  return readdirSync(new URL(`${locale}/`, ROOT)).filter((name) => name.endsWith(".json"))
}

export function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  )
}

export function baseKeys(tree: Tree): string[] {
  return [...new Set(leafKeys(tree).map((key) => key.replace(PLURAL_SUFFIX, "")))].sort()
}

export function hasKey(locale: "ru" | "en", fullKey: string): boolean {
  const [namespace = "", path = ""] = fullKey.split(":")
  return baseKeys(readDictionary(locale, namespace)).includes(path)
}
