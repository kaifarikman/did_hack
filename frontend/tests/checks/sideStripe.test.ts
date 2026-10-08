import { describe, expect, it } from "vitest"
import { noSideStripe } from "../../scripts/checks/rules/sideStripe.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const SPACE = file(
  "src/ui/shared/styles/tokens/space.css",
  ":root { --hairline: 1px; --space-4: 4px; --dot-size: 8px; }",
)
const module = (css: string) => file("src/ui/shared/ui/box/styles.module.css", css)

describe("no-side-stripe", () => {
  it("accepts hairline sides, even borders and dots", () => {
    const css =
      ".box { border-left: var(--hairline) solid var(--border-hairline); border-width: var(--space-4); }\n.box::before { inline-size: var(--dot-size); block-size: var(--dot-size); background-color: var(--x); }"
    expect(noSideStripe.run([SPACE, module(css)])).toEqual([])
  })

  it.each([
    "border-inline-start: 4px solid var(--x);",
    "border-inline: 6px solid var(--x);",
    "border-width: 0 0 0 var(--space-4);",
    "border-left-width: calc(var(--hairline) * 4);",
  ])("reports %s", (declaration) => {
    expect(noSideStripe.run([SPACE, module(`.box { ${declaration} }`)])).toHaveLength(1)
  })

  it("reports a narrow painted pseudo-element", () => {
    const css = ".box::before { inline-size: var(--space-4); background-color: var(--x); }"
    expect(noSideStripe.run([SPACE, module(css)])).toHaveLength(1)
  })
})
