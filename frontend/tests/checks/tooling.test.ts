import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as Record<string, unknown>

describe("tooling", () => {
  it("keeps TypeScript strict with the flags from the rules", () => {
    const options = read("tsconfig.json").compilerOptions as Record<string, unknown>
    for (const flag of [
      "strict",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "verbatimModuleSyntax",
    ])
      expect(options[flag], flag).toBe(true)
    expect((options.paths as Record<string, string[]>)["@/*"]).toEqual(["./src/*"])
  })

  it("runs every gate in verify", () => {
    const scripts = read("package.json").scripts as Record<string, string>
    expect(scripts.verify).toBe(
      "npm run rules && npm run typecheck && npm run lint && npm run test && npm run build",
    )
  })

  it("keeps the Biome rules and formatting from the rules", () => {
    const biome = read("biome.json")
    const formatter = biome.formatter as Record<string, unknown>
    expect([formatter.indentWidth, formatter.lineWidth]).toEqual([2, 96])
    const javascript = (biome.javascript as Record<string, Record<string, unknown>>).formatter
    expect([javascript?.quoteStyle, javascript?.semicolons]).toEqual(["double", "asNeeded"])
    const rules = (biome.linter as Record<string, Record<string, Record<string, unknown>>>)
      .rules
    expect(rules?.style?.noDefaultExport).toBe("error")
    expect(rules?.style?.noNonNullAssertion).toBe("error")
    expect(rules?.style?.useImportType).toBe("error")
    expect(rules?.suspicious?.noExplicitAny).toBe("error")
    const complexity = rules?.complexity?.noExcessiveCognitiveComplexity as {
      options: { maxAllowedComplexity: number }
    }
    expect(complexity.options.maxAllowedComplexity).toBe(15)
  })
})
