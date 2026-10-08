import { describe, expect, it } from "vitest"
import { ICONS } from "@/ui/shared/ui/icon/icons"

describe("icon registry", () => {
  it("maps every glyph to exactly one name", () => {
    const glyphs = Object.values(ICONS)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it("uses kebab-case names", () => {
    for (const name of Object.keys(ICONS)) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })
})
