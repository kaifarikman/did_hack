import { describe, expect, it } from "vitest"
import { buildTokenCss, TOKEN_FILES } from "../../scripts/exportTokens.ts"

const sources = TOKEN_FILES.map((name) => ({
  name,
  text: `/* note */\n:root { --${name.replace(".css", "")}: 1; }`,
}))

describe("exportTokens", () => {
  it("joins token files in layer order without comments", () => {
    const css = buildTokenCss([...sources].reverse())
    expect(css.indexOf("--palette")).toBeLessThan(css.indexOf("--semantic"))
    expect(css.indexOf("--motion")).toBeLessThan(css.indexOf("--keyframes"))
    expect(css).not.toContain("/*")
  })

  it("makes font urls relative to the presentation", () => {
    const withFont = sources.map((source) =>
      source.name === "typography.css"
        ? { ...source, text: '@font-face { src: url("/fonts/Inter-Regular.woff2"); }' }
        : source,
    )
    expect(buildTokenCss(withFont)).toContain('url("fonts/Inter-Regular.woff2")')
  })

  it("fails when a token layer is missing", () => {
    expect(() => buildTokenCss(sources.slice(1))).toThrow(/palette\.css/)
  })
})
