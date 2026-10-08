import { localProperties, splitWords } from "../cssVars.ts"
import { boxSides, resolvePixels } from "../lengths.ts"
import { parseStyles } from "../parse.ts"
import { type TokenTable, tokenTable } from "../tokens.ts"
import type { Check, SourceFile, Violation } from "../types.ts"
import { componentStyles, type DeclarationContext, eachDeclaration } from "./unityCss.ts"

const STRIPE_MAX_PX = 8
const HAIRLINE_PX = 1

function thickerThanHairline(value: string, context: DeclarationContext): boolean {
  return splitWords(value).some((word) => {
    const pixels = resolvePixels(word, context.local, context.tokens)
    return pixels !== null && pixels > HAIRLINE_PX
  })
}

const SIDE_BORDER =
  /^border-(left|right|inline-start|inline-end|inline)(-width)?$|^border-inline-(start|end)-width$/

export function stripeProblem(context: DeclarationContext): string | null {
  const { prop, value } = context
  if (SIDE_BORDER.test(prop) && thickerThanHairline(value, context)) return "side stripe"
  if (prop !== "border-width") return null
  const [top, right, bottom, left] = boxSides(value).map((side) =>
    resolvePixels(side, context.local, context.tokens),
  )
  const thickSide = [right, left].some((side) => (side ?? 0) > HAIRLINE_PX)
  const thinEnds = (top ?? 0) <= HAIRLINE_PX && (bottom ?? 0) <= HAIRLINE_PX
  return thickSide && thinEnds ? "side stripe" : null
}

function pseudoStripes(file: SourceFile, tokens: TokenTable): Violation[] {
  const local = localProperties(file.text)
  const found: Violation[] = []
  parseStyles(file.text).walkRules(/::(before|after)/, (rule) => {
    const values = new Map<string, string>()
    rule.walkDecls((declaration) => {
      values.set(declaration.prop, declaration.value)
    })
    const pixels = (...props: string[]) => {
      const value = props.map((prop) => values.get(prop)).find((item) => item !== undefined)
      return value === undefined ? null : resolvePixels(value, local, tokens)
    }
    const width = pixels("inline-size", "width")
    const height = pixels("block-size", "height")
    const fill = values.get("background-color") ?? values.get("background")
    const painted = fill !== undefined && !/^(none|transparent)$/.test(fill)
    const narrow = width !== null && width > 0 && width <= STRIPE_MAX_PX
    const tall = height === null || height > STRIPE_MAX_PX
    if (painted && narrow && tall)
      found.push({ file: file.path, message: `narrow pseudo stripe: ${rule.selector}` })
  })
  return found
}

export const noSideStripe: Check = {
  id: "no-side-stripe",
  run: (files) => {
    const tokens = tokenTable(files)
    return [
      ...eachDeclaration(files, stripeProblem),
      ...componentStyles(files).flatMap((file) => pseudoStripes(file, tokens)),
    ]
  },
}
