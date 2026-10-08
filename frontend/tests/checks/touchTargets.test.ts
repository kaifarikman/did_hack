import { describe, expect, it } from "vitest"
import { touchTargets } from "../../scripts/checks/rules/touchTargets.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const space = (target = "44px") =>
  file(
    "src/ui/shared/styles/tokens/space.css",
    `:root { --space-4: 4px; --space-12: 12px; --dot-size: 8px; --target-min: ${target}; --control-height: 44px; --control-height-compact: 36px; }`,
  )
const module = (css: string) => file("src/ui/shared/ui/box/styles.module.css", css)
const messages = (...files: SourceFile[]) =>
  touchTargets.run([space(), ...files]).map((item) => item.message)

describe("touch-targets", () => {
  it("passes full-size controls and compact ones whose hit area really reaches 44px", () => {
    const stepper =
      ".step { composes: pressable from './c.css'; inline-size: var(--control-height-compact); block-size: var(--control-height-compact); }\n.step::after { inset: calc((var(--control-height-compact) - var(--target-min)) / 2); }"
    const regular =
      ".button { min-block-size: var(--control-height); }\n.button:hover { color: var(--x); }"
    const compact =
      ".button { --button-height: var(--control-height); min-block-size: var(--button-height); }\n.compact { --button-height: var(--control-height-compact); }\n.button::before { inset-block: calc((var(--button-height) - var(--target-min)) / 2); }\n.button:active { scale: var(--s); }"
    expect(messages(module(stepper))).toEqual([])
    expect(messages(module(regular))).toEqual([])
    expect(messages(module(compact))).toEqual([])
  })

  it("reports sizes in rem", () => {
    expect(
      messages(
        module(
          ".tiny { block-size: 1.5rem; inline-size: 1.5rem; }\n.tiny:active { scale: var(--s); }",
        ),
      ),
    ).toEqual([".tiny is 24px (block) without a 44px hit area"])
  })

  it("reports a target whose height comes from padding", () => {
    expect(
      messages(module(".chip { padding: var(--space-4); }\n.chip:active { scale: var(--s); }")),
    ).toEqual([".chip is 32px (block) without a 44px hit area"])
  })

  it("does not count a hit area that only mentions --target-min", () => {
    const fake =
      ".fake { block-size: var(--dot-size); }\n.fake:active { scale: var(--s); }\n.fake::before { min-block-size: calc(var(--target-min) / 4); }"
    expect(messages(module(fake))).toEqual([".fake is 8px (block) without a 44px hit area"])
  })

  it("treats classes used on interactive markup as targets", () => {
    const css = file("src/ui/features/x/styles.module.css", ".link { block-size: 1rem; }")
    const tsx = file(
      "src/ui/features/x/index.tsx",
      'import styles from "./styles.module.css"\nexport const X = () => <a className={styles.link} href="/">{t("x")}</a>\n',
    )
    expect(touchTargets.run([space(), css, tsx]).map((item) => item.file)).toEqual([css.path])
  })

  it("resolves target tokens through other tokens and reports them below 44px", () => {
    expect(messages()).toEqual([])
    const chained = touchTargets.run([space("var(--space-12)")]).map((item) => item.message)
    expect(chained).toEqual([expect.stringContaining("--target-min is 12")])
  })

  it("reports a missing space.css instead of passing silently", () => {
    expect(touchTargets.run([module(".a { color: var(--x); }")])).toHaveLength(1)
  })

  it("ignores non-interactive boxes and selectors inside :has()", () => {
    const css =
      ".dot { inline-size: 8px; }\n.group:has(.input:focus-visible) { outline: var(--r); }\n.group { min-block-size: 0; }"
    expect(messages(module(css))).toEqual([])
  })
})
