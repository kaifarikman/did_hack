import { describe, expect, it } from "vitest"
import { scaleTokens, signalScope, tokenLayers } from "../../scripts/checks/rules/unityCss.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const tokens = (name: string, text: string) => file(`src/ui/shared/styles/tokens/${name}`, text)
const module = (css: string) => file("src/ui/shared/ui/box/styles.module.css", css)

const PALETTE = tokens(
  "palette.css",
  ":root { --white: #ffffff; --ink: #0d1212; --teal: #64d5b3; --data-brick: #9e4f45; }",
)
const SEMANTIC = tokens(
  "semantic.css",
  ":root { --text-primary: var(--ink); --signal-critical: var(--data-brick); --status-alarm: var(--signal-critical); }",
)

describe("scale-tokens", () => {
  it("accepts scale tokens, also through local component properties", () => {
    const css =
      ".box { --box-radius: var(--radius-card); border-radius: var(--box-radius) var(--radius-card) 0 0; font-size: var(--font-size-body); z-index: var(--layer-popover); box-shadow: var(--shadow-float); padding: var(--space-4) calc(var(--space-12) - var(--hairline)); margin: 0 auto; } @media (min-width: 48rem) { .box { gap: 0; } } @container (min-width: 30rem) { .box { gap: 0; } }"
    expect(scaleTokens.run([module(css)])).toEqual([])
  })

  it.each([
    "border-radius: var(--space-4);",
    "border-radius: calc(var(--radius-card) * 0.7);",
    "box-shadow: var(--shadow-card);",
    "font-size: var(--size);",
    "font: 600 13px/1.1 var(--font-ui);",
    "z-index: 3;",
    "padding: 13px 7px;",
    "margin-block: 3px;",
    "gap: 0.5rem;",
  ])("reports %s", (declaration) => {
    expect(scaleTokens.run([module(`.box { ${declaration} }`)])).toHaveLength(1)
  })

  it("reports breakpoints outside the scale in media, container queries and matchMedia", () => {
    const css =
      "@media (min-width: 860px) { .box { gap: 0; } }\n@container (min-width: 500px) { .box { gap: 0; } }"
    const script = file("src/ui/features/x/media.ts", 'matchMedia("(max-width: 900px)")\n')
    expect(scaleTokens.run([module(css), script])).toHaveLength(3)
  })
})

describe("token-layers and signal-scope", () => {
  it("allows semantic tokens and signals inside the meter", () => {
    const files = [
      PALETTE,
      SEMANTIC,
      module(".box { color: var(--text-primary); }"),
      file(
        "src/ui/shared/ui/meter/styles.module.css",
        ".m { background: var(--status-alarm); }",
      ),
    ]
    expect([...tokenLayers.run(files), ...signalScope.run(files)]).toEqual([])
  })

  it("reports palette tokens, also behind a local alias", () => {
    const files = [PALETTE, module(".box { --box-ink: var(--teal); color: var(--box-ink); }")]
    expect(tokenLayers.run(files).length).toBeGreaterThan(0)
  })

  it("reports signals directly, through semantic aliases and from scripts", () => {
    const files = [
      PALETTE,
      SEMANTIC,
      module(".box { background: var(--signal-critical); color: var(--status-alarm); }"),
      file(
        "src/ui/features/x/paint.ts",
        'el.style.setProperty("color", "var(--status-alarm)")\n',
      ),
    ]
    expect(signalScope.run(files).map((item) => item.message)).toEqual(
      expect.arrayContaining([
        "--signal-critical outside data visualisation",
        "--status-alarm outside data visualisation",
      ]),
    )
    expect(signalScope.run(files).map((item) => item.file)).toContain(
      "src/ui/features/x/paint.ts",
    )
  })

  it("reports a missing palette instead of passing silently", () => {
    expect(tokenLayers.run([module(".box { color: var(--x); }")])).toHaveLength(1)
  })
})
