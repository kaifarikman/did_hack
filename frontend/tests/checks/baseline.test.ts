import { describe, expect, it } from "vitest"
import {
  compareWithBaseline,
  countByFile,
  formatBaseline,
  parseBaseline,
  prunedBaseline,
} from "../../scripts/checks/baseline.ts"
import { CHECKS } from "../../scripts/checks/registry.ts"

describe("ratchet baseline", () => {
  const baseline = parseBaseline("2\tsrc/a.ts\n5\tsrc/b.ts\n")

  it("round-trips through the text format", () => {
    expect(formatBaseline(baseline)).toBe("2\tsrc/a.ts\n5\tsrc/b.ts\n")
    expect(formatBaseline(new Map())).toBe("")
  })

  it("counts violations by file with weights", () => {
    const counts = countByFile([
      { file: "src/a.ts", message: "x" },
      { file: "src/a.ts", message: "y", weight: 3 },
    ])
    expect(counts.get("src/a.ts")).toBe(4)
  })

  it("fails new files and growth, accepts known violations", () => {
    const current = new Map([
      ["src/a.ts", 2],
      ["src/b.ts", 6],
      ["src/c.ts", 1],
    ])
    const { regressions } = compareWithBaseline(current, baseline)
    expect(regressions.map((item) => item.file)).toEqual(["src/b.ts", "src/c.ts"])
  })

  it("only shrinks when pruning", () => {
    const current = new Map([
      ["src/a.ts", 1],
      ["src/c.ts", 9],
    ])
    const { improvements } = compareWithBaseline(current, baseline)
    expect(improvements.map((item) => item.file)).toEqual(["src/a.ts", "src/b.ts"])
    expect([...prunedBaseline(current, baseline)]).toEqual([["src/a.ts", 1]])
  })

  it("registers every check with a unique id", () => {
    const ids = CHECKS.map((check) => check.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(22)
  })
})
