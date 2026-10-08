import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { NAMESPACES } from "@/ui/shared/i18n/resources"

const LOCALES_DIR = fileURLToPath(
  new URL("../../../src/ui/shared/i18n/locales", import.meta.url),
)
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

type Tree = { readonly [key: string]: unknown }

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? leafKeys(value as Tree, `${prefix}${key}.`)
      : [`${prefix}${key}`.replace(PLURAL_SUFFIX, "")],
  )
}

function readKeys(locale: string, file: string): string[] {
  const tree = JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), "utf8")) as Tree
  return [...new Set(leafKeys(tree))].sort()
}

const locales = readdirSync(LOCALES_DIR).sort()
const filesOf = (locale: string) => readdirSync(join(LOCALES_DIR, locale)).sort()

describe("dictionaries", () => {
  it("has the same namespace files for every locale", () => {
    expect(locales).toEqual(["en", "ru"])
    expect(filesOf("ru")).toEqual(filesOf("en"))
  })

  it("registers every namespace file in resources", () => {
    const registered = NAMESPACES.map((namespace) => `${namespace}.json`).sort()
    expect(filesOf("en")).toEqual(registered)
  })

  it.each(filesOf("en"))("has identical keys in ru and en for %s", (file) => {
    expect(readKeys("ru", file)).toEqual(readKeys("en", file))
  })
})

describe("system dictionaries", () => {
  const leafValues = (tree: Tree): string[] =>
    Object.values(tree).flatMap((value) =>
      typeof value === "object" && value !== null ? leafValues(value as Tree) : [String(value)],
    )

  it.each(
    locales.flatMap((locale) => ["common.json", "errors.json"].map((file) => [locale, file])),
  )("%s/%s shows no internal snake_case identifiers", (locale, file) => {
    const tree = JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), "utf8")) as Tree
    expect(leafValues(tree).filter((value) => /\b[a-z]+_[a-z_]+\b/.test(value))).toEqual([])
  })
})
