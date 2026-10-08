import { describe, expect, it } from "vitest"
import { cyrillic, jsxText } from "../../scripts/checks/rules/texts.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const CYRILLIC_WORD = String.fromCodePoint(0x43f, 0x440, 0x438, 0x432, 0x435, 0x442)
const ESCAPED_WORD = ["041f", "0443", "0441", "043a"].map((code) => `\\${"u"}${code}`).join("")
const file = (path: string, text: string): SourceFile => ({ path, text })

describe("cyrillic", () => {
  it("passes latin sources, dictionaries and fixture examples", () => {
    const files = [
      file("src/a.ts", 'export const a = "hello"\n'),
      file("src/ui/shared/i18n/locales/ru/common.json", `{"a": "${CYRILLIC_WORD}"}`),
      file("src/adapters/fixture/examples/map.json", `{"a": "${CYRILLIC_WORD}"}`),
    ]
    expect(cyrillic.run(files)).toEqual([])
  })

  it("reports each source line with cyrillic", () => {
    const text = `export const a = "${CYRILLIC_WORD}"\nexport const b = "${CYRILLIC_WORD}"\n`
    expect(cyrillic.run([file("src/a.ts", text)])).toHaveLength(2)
  })

  it.each([
    "e2e/a.spec.ts",
    "tests/probe/x.test.ts",
    "docker/probe.sh",
    "index.html",
    "src/ui/features/probe/locales/text.ts",
  ])("scans %s too", (path) => {
    expect(cyrillic.run([file(path, `x = "${CYRILLIC_WORD}"\n`)])).toHaveLength(1)
  })

  it("reports escaped cyrillic", () => {
    expect(
      cyrillic.run([file("src/a.ts", `const greeting = "${ESCAPED_WORD}"\n`)]),
    ).toHaveLength(1)
  })
})

describe("jsx-text", () => {
  it("passes translated text, punctuation and class name branches", () => {
    const text =
      'export const A = ({ on }) => <p title={t("x")} className={on ? "a" : "b"}>{t("y")} · {count}{" "}{value ?? "—"}</p>\n'
    expect(jsxText.run([file("src/a.tsx", text)])).toEqual([])
  })

  it("reports literal children and text attributes", () => {
    const text = 'export const A = () => <p aria-label="Close" title="Hint">Hello</p>\n'
    expect(jsxText.run([file("src/a.tsx", text)])).toHaveLength(3)
  })

  it("reports text hidden in expression containers, branches and component props", () => {
    const text = [
      "export const A = ({ on }) => (",
      "  <div>",
      '    {"Start mission"}',
      "    {`Stop mission`}",
      '    {on ? "Running" : "Idle"}',
      '    <span aria-label={"Close dialog"} />',
      '    <img alt={"Robot photo"} src="/a.png" />',
      '    <Button label="Export journal" />',
      '    <Card eyebrow="Mission" />',
      "  </div>",
      ")",
    ].join("\n")
    expect(jsxText.run([file("src/ui/features/x/index.tsx", text)])).toHaveLength(8)
  })

  it("reports literal text assigned to the document from scripts", () => {
    const text =
      'document.title = "Mission panel"\nel.setAttribute("aria-label", "Close")\nel.textContent = `Ready`\n'
    expect(jsxText.run([file("src/ui/app/title.ts", text)])).toHaveLength(3)
  })

  it("ignores tests", () => {
    expect(
      jsxText.run([file("tests/a.test.tsx", "export const A = () => <p>Hello</p>\n")]),
    ).toEqual([])
  })
})
