import { describe, expect, it } from "vitest"
import { cssDuplicates } from "../../scripts/checks/rules/cssDuplicates.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const TOKENS = file(
  "src/ui/shared/styles/tokens/space.css",
  ":root { --space-24: 24px; --space-card: var(--space-24); }",
)
const block = "color: var(--a); background-color: var(--b); border-radius: var(--c);"

describe("css-duplicates", () => {
  it("passes blocks that share fewer than three declarations or only layout glue", () => {
    const files = [
      file(
        "src/a.module.css",
        ".a { color: var(--a); background-color: var(--b); display: flex; gap: var(--g); align-items: center; }",
      ),
      file(
        "src/b.module.css",
        ".b { color: var(--a); background-color: var(--b); display: flex; gap: var(--g); align-items: center; }",
      ),
    ]
    expect(cssDuplicates.run(files)).toEqual([])
  })

  it("does not merge the same selector across media queries", () => {
    const css =
      ".a { color: var(--a); }\n@media (min-width: 48rem) { .a { background-color: var(--b); border-radius: var(--c); } }"
    expect(
      cssDuplicates.run([
        file("src/a.module.css", css),
        file("src/b.module.css", `.b { ${block} }`),
      ]),
    ).toEqual([])
  })

  it("reports a repeated block of three declarations", () => {
    const files = [
      file("src/a.module.css", `.a { ${block} }`),
      file("src/b.module.css", `.b { ${block} }`),
    ]
    expect(cssDuplicates.run(files)).toEqual([
      expect.objectContaining({ file: "src/b.module.css" }),
    ])
  })

  it("sees through split rules, background shorthands and token aliases", () => {
    const original = file(
      "src/a.module.css",
      ".a { padding: var(--space-card); border-radius: var(--radius-card); background-color: var(--surface-card); }",
    )
    const split = file(
      "src/b.module.css",
      ".b { padding: var(--space-card); border-radius: var(--radius-card); }\n.b { background-color: var(--surface-card); }",
    )
    const aliased = file(
      "src/c.module.css",
      ".c { padding: var(--space-24); border-radius: var(--radius-card); background: var(--surface-card); }",
    )
    expect(
      cssDuplicates.run([TOKENS, original, split, aliased]).map((item) => item.file),
    ).toEqual(["src/b.module.css", "src/c.module.css", "src/c.module.css"])
  })
})
