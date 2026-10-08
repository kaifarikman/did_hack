import { describe, expect, it } from "vitest"
import { consistency } from "../../scripts/checks/rules/consistency.ts"
import { canonicalGlyph, iconAlias } from "../../scripts/checks/rules/iconAlias.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const feature = (tsx: string) => file("src/ui/features/mission/form/index.tsx", tsx)
const featureStyle = (css: string) =>
  file("src/ui/features/mission/form/styles.module.css", css)

describe("consistency", () => {
  it("passes screens built from shared controls", () => {
    const tsx =
      'const kind = "text"\nexport const F = () => <Card title={t}><Eyebrow>tag</Eyebrow><h1>app</h1><Select label={a} /><input type={kind} /><NoValue /></Card>\n'
    const css =
      ".form { display: grid; overflow: hidden; border-radius: var(--radius-inner); background: var(--surface-tint); }"
    expect(consistency.run([feature(tsx), featureStyle(css)])).toEqual([])
  })

  it.each([
    "<select />",
    '<input type="checkbox" />',
    '<input type="number" />',
    "<details />",
    "<button />",
    '<div role="tablist" />',
    "<p>—</p>",
    "<h2>title</h2>",
    '<Eyebrow as="h3">title</Eyebrow>',
  ])("reports %s in a screen", (element) => {
    expect(consistency.run([feature(`export const F = () => ${element}\n`)])).toHaveLength(1)
  })

  it.each([
    [
      'const kind = "checkbox"\nexport const F = () => <input type={kind} />\n',
      "constant type",
    ],
    ['export const F = () => <input {...{ type: "radio" }} />\n', "spread type"],
    ['export const F = () => <div role={"tablist"} />\n', "expression role"],
    ['export const F = () => <Eyebrow as={"h3"}>x</Eyebrow>\n', "expression as"],
    ['export const F = ({ on }) => <input type={on ? "radio" : "text"} />\n', "ternary type"],
    ['export const F = () => createElement("select")\n', "createElement"],
    ['export const F = ({ value }) => <p>{value ?? "—"}</p>\n', "dash fallback"],
  ])("sees through %s (%s)", (tsx) => {
    expect(consistency.run([feature(tsx)])).toHaveLength(1)
  })

  it("reports uppercase, scrolling containers and own card surfaces in screen styles", () => {
    const css =
      ".a { text-transform: uppercase; } .b { overflow-y: auto; } .c { --c-overflow: scroll; overflow: var(--c-overflow); } .d { padding: var(--space-inner); border-radius: var(--radius-inner); background: var(--surface-tint); }"
    expect(consistency.run([file("src/ui/app/shell/styles.module.css", css)])).toHaveLength(4)
  })

  it("ignores shared primitives", () => {
    const tsx = "export const S = () => <select />\n"
    expect(consistency.run([file("src/ui/shared/ui/select/index.tsx", tsx)])).toEqual([])
  })
})

describe("icon-alias", () => {
  const registry = (imports: string, body: string) =>
    file(
      "src/ui/shared/ui/icon/icons.ts",
      `import { ${imports} } from "lucide-react"\nexport const ICONS = {\n${body}\n}\n`,
    )

  it("passes one name per glyph and imports only in the registry", () => {
    const icons = registry(
      "X, Check, Map as MapGlyph",
      "  close: X,\n  check: Check,\n  map: MapGlyph,",
    )
    expect(iconAlias.run([icons])).toEqual([])
  })

  it("normalises Icon and Lucide aliases of the same glyph", () => {
    expect([
      canonicalGlyph("XIcon"),
      canonicalGlyph("LucideX"),
      canonicalGlyph("Icon"),
    ]).toEqual(["X", "X", "Icon"])
    const icons = registry(
      "X, XIcon, LucideX",
      '  close: X,\n  "probe-close": XIcon,\n  dismiss: LucideX,',
    )
    expect(iconAlias.run([icons]).map((item) => item.message)).toEqual(["X has several names"])
  })

  it("reports stray lucide imports, also from package subpaths", () => {
    const stray = file(
      "src/ui/features/x/index.tsx",
      'import { X } from "lucide-react"\nexport const a = X\n',
    )
    const dynamic = file(
      "src/ui/features/x/icons.tsx",
      'import { DynamicIcon } from "lucide-react/dynamic"\nexport const b = DynamicIcon\n',
    )
    expect(iconAlias.run([registry("X", "  close: X,"), stray, dynamic])).toHaveLength(2)
  })
})
