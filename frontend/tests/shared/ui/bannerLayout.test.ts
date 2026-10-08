import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

const css = postcss.parse(
  readFileSync(resolve(process.cwd(), "src/ui/shared/ui/banner/styles.module.css"), "utf8"),
)

function declarations(selector: string): Map<string, string> {
  const found = new Map<string, string>()
  css.walkRules((rule) => {
    if (rule.selector !== selector) return
    rule.walkDecls((declaration) => {
      found.set(declaration.prop, declaration.value)
    })
  })
  if (found.size === 0) throw new Error(`no rule ${selector}`)
  return found
}

const LENGTH = /\d*\.?\d+(px|rem|em)|var\(--/

describe("Banner layout", () => {
  it("stacks the action under the text in one column", () => {
    const content = declarations(".content")
    expect(content.get("flex-direction")).toBe("column")
    expect(content.get("align-items")).toBe("flex-start")
  })

  it("lets the content, not a flex basis, decide the height of the text block", () => {
    const body = declarations(".body")
    const flex = body.get("flex") ?? "none"
    const basis = flex.split(/\s+/)[2] ?? ""
    expect(flex === "none" || !LENGTH.test(basis)).toBe(true)
    expect(body.has("block-size") || body.has("min-block-size")).toBe(false)
  })
})
