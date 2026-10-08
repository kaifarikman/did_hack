import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { buildTokenCss, TOKEN_FILES } from "../../scripts/exportTokens.ts"

const frontendRoot = process.cwd()
const presentation = resolve(frontendRoot, "..", "presentation")
const tokensDir = resolve(frontendRoot, "src/ui/shared/styles/tokens")
const slides = readFileSync(resolve(presentation, "goatwhistle.html"), "utf8")
const styleBlock = slides.slice(slides.indexOf("<style>"), slides.indexOf("</style>"))

describe("presentation shares the panel tokens", () => {
  it("ships the current token export", () => {
    const sources = TOKEN_FILES.map((name) => ({
      name,
      text: readFileSync(resolve(tokensDir, name), "utf8"),
    }))
    expect(readFileSync(resolve(presentation, "tokens.css"), "utf8")).toBe(
      buildTokenCss(sources),
    )
    expect(slides).toContain('<link rel="stylesheet" href="tokens.css">')
  })

  it("has no own colors, easings or comments", () => {
    expect(slides).not.toMatch(/#[0-9a-f]{6}\b/i)
    expect(styleBlock).not.toMatch(/rgba?\(|cubic-bezier\(/)
    expect(slides).not.toMatch(/\/\*|<!--/)
    expect(slides).not.toContain("IBM Plex")
  })

  it("times css motion only through tokens", () => {
    const literalDurations = styleBlock.match(/(?<![\w-])\d*\.?\d+m?s(?![\w-])/g) ?? []
    expect(literalDurations.filter((value) => value !== "0ms")).toEqual([])
  })
})
