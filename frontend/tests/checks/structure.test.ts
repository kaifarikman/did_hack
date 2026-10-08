import { describe, expect, it } from "vitest"
import { fileLength, MAX_LINES } from "../../scripts/checks/rules/fileLength.ts"
import { importCycles } from "../../scripts/checks/rules/importCycles.ts"
import { noComments } from "../../scripts/checks/rules/noComments.ts"
import { packageSize, packageSubject } from "../../scripts/checks/rules/packageShape.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text = "export const value = 1\n"): SourceFile => ({ path, text })
const lines = (count: number) => "x\n".repeat(count)

describe("file-length", () => {
  it("passes a file at the limit", () => {
    expect(fileLength.run([file("src/a.ts", lines(MAX_LINES))])).toEqual([])
  })

  it("weights a long file by its excess lines", () => {
    const [violation] = fileLength.run([file("src/a.css", lines(MAX_LINES + 7))])
    expect(violation).toMatchObject({ file: "src/a.css", weight: 7 })
  })

  it("measures plain JavaScript and shell scripts too", () => {
    expect(fileLength.run([file("src/legacy.js", lines(MAX_LINES + 1))])).toHaveLength(1)
    expect(fileLength.run([file("e2e/long.spec.ts", lines(MAX_LINES + 1))])).toHaveLength(1)
  })

  it("ignores fixture examples", () => {
    const example = file("src/adapters/fixture/examples/map.json", lines(900))
    expect(fileLength.run([example])).toEqual([])
  })
})

describe("no-comments", () => {
  it("passes code without comments and comment-like strings", () => {
    const code = file("src/a.ts", 'export const url = "http://x"\nexport const re = /\\/\\//\n')
    expect(noComments.run([code])).toEqual([])
  })

  it.each([
    ["src/a.ts", "// note\nexport const a = 1\n"],
    ["src/a.tsx", "export const A = () => <div>{/* note */}</div>\n"],
    ["src/a.css", ".a { color: var(--x); }\n/* note */\n"],
    ["index.html", "<div><!-- note --></div>\n"],
    ["tsconfig.json", '{\n  // note\n  "a": "//not"\n}\n'],
  ])("reports a comment in %s", (path, text) => {
    expect(noComments.run([file(path, text)])).toHaveLength(1)
  })

  it.each([
    ["docker/probe.sh", "#!/bin/sh\n# docker note\necho ok\n"],
    ["docker/default.conf.template", "server {\n    # note\n}\n"],
    ["Dockerfile", "# note\nFROM node\n"],
    ["src/probe.html", "<style>\n/* inline */\n.a { color: var(--x); }\n</style>\n"],
    ["src/probe.html", "<script>\n// inline\n</script>\n"],
    ["src/legacy.jsx", "// jsx note\nexport const J = 1\n"],
  ])("reports a comment in %s", (path, text) => {
    expect(noComments.run([file(path, text)])).toHaveLength(1)
  })

  it("keeps the shebang of shell scripts", () => {
    expect(noComments.run([file("docker/a.sh", "#!/bin/sh\nset -eu\n")])).toEqual([])
  })

  it("allows biome-ignore and ts-expect-error with a reason", () => {
    const text = [
      "// biome-ignore lint/style/noX: needed for a reason",
      "export const a = 1",
      "// @ts-expect-error library type is wrong",
      "export const b = 2",
      "// biome-ignore lint/style/noX",
      "export const c = 3",
    ].join("\n")
    expect(noComments.run([file("src/a.ts", text)])).toHaveLength(1)
  })
})

describe("package-size", () => {
  it("passes a small folder", () => {
    expect(packageSize.run([file("src/a/x.ts"), file("src/a/y.css")])).toEqual([])
  })

  it("reports a folder with too many sources or tests", () => {
    const sources = Array.from({ length: 21 }, (_, index) => file(`src/a/f${index}.ts`))
    const tests = Array.from({ length: 31 }, (_, index) => file(`tests/a/f${index}.test.ts`))
    expect(packageSize.run([...sources, ...tests]).map((violation) => violation.file)).toEqual([
      "src/a",
      "tests/a",
    ])
  })
})

describe("package-subject", () => {
  it("passes subject folders and ui/shared", () => {
    expect(
      packageSubject.run([file("src/ui/shared/ui/x.ts"), file("src/domain/x.ts")]),
    ).toEqual([])
  })

  it.each([
    "src/utils/x.ts",
    "src/ui/util/x.ts",
    "src/ui/helpers/x.ts",
    "src/ui/features/probe/helper/x.ts",
    "src/ui/features/shared/x.ts",
    "tests/lib/x.ts",
    "e2e/helpers/x.ts",
    "scripts/utils/x.ts",
  ])("reports %s", (path) => {
    expect(packageSubject.run([file(path)])).toHaveLength(1)
  })
})

describe("import-cycles", () => {
  it("passes an acyclic graph and type-only back edges", () => {
    const files = [
      file("src/a.ts", 'import { b } from "./b"\nexport const a = b\n'),
      file("src/b.ts", 'import type { A } from "@/a"\nexport const b = 1\n'),
    ]
    expect(importCycles.run(files)).toEqual([])
  })

  it("reports a cycle written with .js specifiers", () => {
    const files = [
      file("src/a.ts", 'import { beta } from "./b.js"\nexport const alpha = () => beta()\n'),
      file("src/b.ts", 'import { alpha } from "./a.js"\nexport const beta = () => alpha()\n'),
    ]
    expect(importCycles.run(files)).toHaveLength(1)
  })

  it("reports a runtime cycle through the alias and index files", () => {
    const files = [
      file("src/a.ts", 'import { b } from "@/feature"\nexport const a = b\n'),
      file("src/feature/index.ts", 'export { b } from "./b"\n'),
      file("src/feature/b.ts", 'import { a } from "../a"\nexport const b = a\n'),
    ]
    const [violation] = importCycles.run(files)
    expect(violation?.message).toContain("src/feature/b.ts")
  })
})
