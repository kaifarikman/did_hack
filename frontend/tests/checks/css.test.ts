import { describe, expect, it } from "vitest"
import { cssModules } from "../../scripts/checks/rules/cssStructure.ts"
import {
  cssLiterals,
  cssTokenRefs,
  cssTransitions,
} from "../../scripts/checks/rules/cssValues.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const TOKENS = file(
  "src/ui/shared/styles/tokens/motion.css",
  ":root { --surface-card: #ffffff; --dur-fast: 160ms; --ease-out: cubic-bezier(0.23, 1, 0.32, 1); --transition-control: color var(--dur-fast); --transition-grow: width var(--dur-fast); --motion-fade-in: kf 1ms; }",
)
const component = (
  css: string,
  script = 'import styles from "./styles.module.css"\nexport const c = styles.box\n',
) => [
  file("src/ui/shared/ui/box/styles.module.css", css),
  file("src/ui/shared/ui/box/index.tsx", script),
]
const tsx = (body: string) => file("src/ui/features/x/index.tsx", body)

describe("css-literals", () => {
  it("allows literals inside tokens, var() elsewhere and dynamic inline properties", () => {
    const files = [
      TOKENS,
      ...component(".box { color: var(--surface-card); border-radius: var(--r); }"),
      tsx(
        'export const X = ({ i }) => <p style={{ "--i": i }} />\nel.style.blockSize = "auto"\n',
      ),
    ]
    expect(cssLiterals.run(files)).toEqual([])
  })

  it.each([
    "color: #fff;",
    "background: rgb(0 0 0);",
    "color: white;",
    "color: tomato;",
    "outline-color: cyan;",
    "transition: opacity 200ms;",
    "animation-timing-function: cubic-bezier(0, 0, 1, 1);",
    "color: var(--x) !important;",
    "border-radius: 12px;",
    "box-shadow: 0 0 4px var(--x);",
    "filter: drop-shadow(0 2px 6px var(--border-strong));",
  ])("reports %s", (declaration) => {
    expect(cssLiterals.run(component(`.box { ${declaration} }`)).length).toBeGreaterThan(0)
  })

  it("reports inline styles and element.style literals in scripts", () => {
    const inline = tsx(
      'export const X = () => <div style={{ color: "#ff0000", transitionDuration: "200ms", borderRadius: 3, fontSize: 13 }} />\n',
    )
    const imperative = file(
      "src/ui/features/x/probe.ts",
      'el.style.transition = "opacity 200ms ease-in"\nel.style.color = "#ff0000"\nel.style.setProperty("color", "tomato")\n',
    )
    expect(cssLiterals.run([inline])).toHaveLength(4)
    expect(cssLiterals.run([imperative]).length).toBeGreaterThanOrEqual(3)
  })
})

describe("css-token-refs", () => {
  it("accepts tokens, local properties and properties set from scripts", () => {
    const files = [
      TOKENS,
      ...component(
        ".box { --box-surface: var(--surface-card); background: var(--box-surface); scale: var(--box-value); }",
        'import styles from "./styles.module.css"\nexport const s = { "--box-value": 1, c: styles.box }\nmotionMs("--dur-fast")\n',
      ),
    ]
    expect(cssTokenRefs.run(files)).toEqual([])
  })

  it("reports an unknown property in CSS and an unknown token read from a script", () => {
    expect(
      cssTokenRefs.run([TOKENS, ...component(".box { color: var(--surface-crad); }")]),
    ).toHaveLength(1)
    const reader = file("src/ui/x.ts", 'motionMs("--dur-typo")\nconst note = "--dur-typo"\n')
    expect(cssTokenRefs.run([TOKENS, reader]).map((item) => item.message)).toEqual([
      "script reads unknown token --dur-typo",
    ])
  })
})

describe("css-modules", () => {
  it("passes a module used by its own component and shared classes used through composes", () => {
    const shared = file(
      "src/ui/shared/styles/compose.module.css",
      ".pressable { color: var(--a); }",
    )
    const files = [
      shared,
      ...component(
        '.box { composes: pressable from "../../styles/compose.module.css"; color: var(--a); }',
      ),
    ]
    expect(cssModules.run(files)).toEqual([])
  })

  it("reports unused classes, foreign importers, global sheets and unused shared classes", () => {
    const files = [
      ...component(".box { color: var(--a); } .ghost { color: var(--a); }"),
      file(
        "src/ui/features/x/index.tsx",
        'import styles from "../../../ui/shared/ui/box/styles.module.css"\nexport const x = styles.box\n',
      ),
      file("src/ui/legacy.css", ".a { color: var(--a); }"),
      file("src/ui/shared/styles/compose.module.css", ".deadProbe { color: var(--a); }"),
      file("src/ui/shared/styles/orphan.css", "@font-face { font-family: x; }"),
    ]
    const messages = cssModules.run(files).map((violation) => violation.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        "unused class .ghost",
        expect.stringContaining("imported outside its component"),
        "global stylesheet outside ui/shared/styles",
        "module is not imported",
        "stylesheet is not imported",
      ]),
    )
  })

  it("reports :global and @import inside a module", () => {
    const css =
      '@import "../../styles/reset.css";\n:global(body) { color: var(--a); }\n.box { color: var(--a); }'
    expect(cssModules.run(component(css)).map((item) => item.message)).toEqual([
      expect.stringContaining("@import"),
      expect.stringContaining(":global"),
    ])
  })
})

describe("css-transitions", () => {
  it("passes token transitions, motion tokens and local aliases of them", () => {
    const css =
      ".box { --box-motion: var(--motion-fade-in); transition: var(--transition-control); animation: var(--box-motion); }"
    expect(cssTransitions.run([TOKENS, ...component(css)])).toEqual([])
  })

  it.each([
    "transition: all var(--dur-fast);",
    "transition: width var(--dur-fast) var(--ease-out);",
    "transition-property: height;",
    "animation: spin 1s;",
    "animation-name: spin;",
    "animation-duration: 2s;",
    "transition: var(--transition-grow);",
    "--transition-box: width var(--dur-fast); transition: var(--box-anything);",
    "--box-anything: width var(--dur-fast); transition: var(--box-anything);",
    "--motion-box: grow var(--dur-fast); animation: var(--motion-box);",
    "animation: var(--motion-missing);",
  ])("reports %s", (declaration) => {
    expect(
      cssTransitions.run([TOKENS, ...component(`.box { ${declaration} }`)]).length,
    ).toBeGreaterThan(0)
  })

  it("reports local @keyframes", () => {
    const css = "@keyframes grow { from { width: 0; } }\n.box { color: var(--a); }"
    expect(cssTransitions.run([TOKENS, ...component(css)])).toHaveLength(1)
  })
})
