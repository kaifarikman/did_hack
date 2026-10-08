import { describe, expect, it } from "vitest"
import { contrast, surfaceLadder } from "../../scripts/checks/rules/unityTokens.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const tokens = (name: string, text: string): SourceFile => ({
  path: `src/ui/shared/styles/tokens/${name}`,
  text,
})

const PALETTE = tokens(
  "palette.css",
  ":root { --white: #ffffff; --ink: #0d1212; --sage: #d3e4df; --deep: #bfd3cd; --mint: #edf4f2; --forest: #34484a; --grey: #565959; --teal: #64d5b3; --wall: #637676; }",
)
const semantic = (overrides = "") =>
  tokens(
    "semantic.css",
    `:root {
  --surface-canvas: var(--sage); --surface-card: var(--white); --surface-tint: var(--mint);
  --surface-selected: var(--white); --surface-inverse: var(--forest);
  --surface-inverse-strong: var(--ink); --surface-tooltip: var(--ink); --action-dark: var(--ink);
  --action-primary: var(--teal);
  --surface-card-hover: color-mix(in oklab, var(--white), var(--carbon) 3%);
  --surface-tint-hover: color-mix(in oklab, var(--mint), var(--carbon) 5%);
  --text-primary: var(--ink); --text-secondary: var(--grey); --text-disabled: var(--deep);
  --text-on-inverse: var(--white); --text-on-inverse-secondary: var(--white);
  --text-on-action: var(--ink); --text-on-tooltip: var(--white);
  --focus-ring-color: var(--ink); --focus-ring-color-inverse: var(--white);
  --data-free: var(--white); --data-unknown: var(--deep); --data-obstacle: var(--wall);
  --data-robot: var(--ink);
  --border-strong: var(--grey); ${overrides}
}`,
  )
const messages = (overrides: string) =>
  contrast.run([PALETTE, semantic(overrides)]).map((violation) => violation.message)

describe("contrast and surface-ladder", () => {
  it("passes readable text on every surface, visible rings and map marks", () => {
    const files = [PALETTE, semantic()]
    expect([...contrast.run(files), ...surfaceLadder.run(files)]).toEqual([])
  })

  it("checks every --text-* token, not a fixed list", () => {
    expect(messages("--text-accent: var(--teal);")).toEqual(
      expect.arrayContaining([expect.stringContaining("--text-accent on --surface-card")]),
    )
  })

  it("checks the focus ring on inverse surfaces", () => {
    expect(messages("--focus-ring-color-inverse: var(--forest);")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("--focus-ring-color-inverse on --surface-inverse"),
      ]),
    )
  })

  it("holds map marks at 3:1 against free and unknown cells", () => {
    expect(messages("--data-hazard: var(--teal);")).toEqual([
      expect.stringContaining("--data-hazard on --data-free"),
      expect.stringContaining("--data-hazard on --data-unknown"),
    ])
  })

  it("reports an --text-on-* token without a matching surface", () => {
    expect(messages("--text-on-banner: var(--ink);")).toEqual([
      "cannot resolve --text-on-banner on --surface-banner",
    ])
  })

  it("reports uneven surfaces and missing tokens", () => {
    const files = [
      PALETTE,
      semantic("--surface-tint: var(--white); --surface-card-hover: var(--sage);"),
    ]
    expect(surfaceLadder.run(files)).toHaveLength(2)
    expect(contrast.run([PALETTE])).toHaveLength(1)
  })
})
