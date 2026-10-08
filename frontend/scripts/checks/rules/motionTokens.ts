import { expandVars, splitTopLevel, splitWords } from "../cssVars.ts"
import { resolvePixels } from "../lengths.ts"
import { parseStyles } from "../parse.ts"
import { rootDeclarations, type TokenTable, tokenFile, tokenTable } from "../tokens.ts"
import { type Check, type SourceFile, TOKENS_DIR, type Violation } from "../types.ts"
import { ALLOWED_TRANSITION_PROPERTIES } from "./cssValues.ts"

const ALLOWED_KEYFRAME_PROPERTIES = new Set(["opacity", "transform", "clip-path", "filter"])
export const UI_DURATION_LIMIT_MS = 300
export const MAX_BLUR_PX = 2
export const EASE_IN_TOLERANCE = 0.02
export const RARE_EVENT_DURATIONS = new Set([
  "--dur-slow",
  "--dur-draw",
  "--dur-breathe",
  "--dur-spin",
])
const CUBIC_BEZIER = /cubic-bezier\(([^)]*)\)/g
const EASE_IN_KEYWORD = /(?<![\w-])ease-in(?![\w-])/
const SCALE_CALL = /scale[XYZ3d]*\(([^)]*)\)/g
const BLUR_CALL = /blur\(([^)]*)\)/g
const NO_LOCALS = new Map<string, readonly string[]>()

function durationOf(value: string | undefined): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value ?? "")
  if (match === null) return Number.NaN
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1])
}

function bezierPoint(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
}

export function curveProblem(points: readonly number[]): string | null {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = points
  if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) return "overshooting (bounce) curve"
  const middle = 0.5
  const lagging = bezierPoint(middle, y1, y2) < bezierPoint(middle, x1, x2) - EASE_IN_TOLERANCE
  return lagging ? "ease-in curve" : null
}

export function easingProblems(value: string): string[] {
  const problems = [...value.matchAll(CUBIC_BEZIER)].flatMap((match) => {
    const problem = curveProblem((match[1] ?? "").split(",").map(Number))
    return problem === null ? [] : [problem]
  })
  return EASE_IN_KEYWORD.test(value) ? [...problems, "ease-in keyword"] : problems
}

interface MotionContext {
  readonly root: ReadonlyMap<string, string>
  readonly reduced: ReadonlyMap<string, string>
  readonly keyframes: ReadonlySet<string>
  readonly tokens: TokenTable
}

type TokenRule = (name: string, value: string, context: MotionContext) => string | null

const lengthRule: TokenRule = (name, value) =>
  name.startsWith("--dur-") &&
  !RARE_EVENT_DURATIONS.has(name) &&
  !(durationOf(value) < UI_DURATION_LIMIT_MS)
    ? `${name} is ${UI_DURATION_LIMIT_MS}ms or longer for UI`
    : null

const reducedRule: TokenRule = (name, _value, context) =>
  name.startsWith("--dur-") && context.reduced.get(name) !== "1ms"
    ? `${name} is not 1ms under reduced motion`
    : null

const exitRule: TokenRule = (name, value, context) => {
  if (!name.endsWith("-exit")) return null
  const entrance = name === "--dur-exit" ? "--dur-base" : name.replace(/-exit$/, "")
  return durationOf(value) < durationOf(context.root.get(entrance))
    ? null
    : `${name} is not shorter than ${entrance}`
}

const keyframeRule: TokenRule = (name, value, context) =>
  name.startsWith("--motion-") &&
  value !== "none" &&
  !context.keyframes.has(splitWords(value)[0] ?? "")
    ? `${name} points to a missing keyframe`
    : null

function transitionProblems(name: string, value: string, tokens: TokenTable): string[] {
  if (!name.startsWith("--transition-")) return []
  return expandVars(value, NO_LOCALS, tokens)
    .flatMap((variant) => splitTopLevel(variant, ","))
    .map((part) => splitWords(part)[0] ?? "")
    .filter((property) => !property.startsWith("--"))
    .filter((property) => !ALLOWED_TRANSITION_PROPERTIES.has(property))
    .map((property) => `${name} transitions ${property}`)
}

const TOKEN_RULES: readonly TokenRule[] = [lengthRule, reducedRule, exitRule, keyframeRule]

function tokenProblems(name: string, value: string, context: MotionContext): string[] {
  const problems = TOKEN_RULES.map((rule) => rule(name, value, context)).filter(
    (problem): problem is string => problem !== null,
  )
  return [
    ...new Set([
      ...problems,
      ...transitionProblems(name, value, context.tokens),
      ...easingProblems(value).map((item) => `${name}: ${item}`),
    ]),
  ]
}

function valueProblems(keyframe: string, value: string, tokens: TokenTable): string[] {
  return expandVars(value, NO_LOCALS, tokens).flatMap((variant) => [
    ...[...variant.matchAll(SCALE_CALL)]
      .filter((match) => Number((match[1] ?? "").split(",")[0]) === 0)
      .map(() => `@keyframes ${keyframe} starts from scale(0)`),
    ...[...variant.matchAll(BLUR_CALL)]
      .map((match) => resolvePixels(match[1] ?? "", NO_LOCALS, tokens))
      .filter((blur) => blur !== null && blur > MAX_BLUR_PX)
      .map(() => `@keyframes ${keyframe} blurs more than ${MAX_BLUR_PX}px`),
  ])
}

function keyframeProblems(keyframes: SourceFile, tokens: TokenTable): string[] {
  const problems: string[] = []
  parseStyles(keyframes.text).walkAtRules("keyframes", (rule) => {
    rule.walkDecls(({ prop, value }) => {
      if (!ALLOWED_KEYFRAME_PROPERTIES.has(prop))
        problems.push(`@keyframes ${rule.params} animates ${prop}`)
      problems.push(...valueProblems(rule.params, value, tokens))
    })
  })
  return [...new Set(problems)]
}

function motionProblems(
  motion: SourceFile,
  keyframes: SourceFile,
  tokens: TokenTable,
): string[] {
  const reducedText = motion.text.slice(motion.text.indexOf("@media (prefers-reduced-motion"))
  const names = new Set<string>()
  parseStyles(keyframes.text).walkAtRules("keyframes", (rule) => {
    names.add(rule.params.trim())
  })
  const context: MotionContext = {
    root: rootDeclarations(motion.text),
    reduced: rootDeclarations(reducedText.replace("@media", "")),
    keyframes: names,
    tokens,
  }
  const problems = [...context.root].flatMap(([name, value]) =>
    tokenProblems(name, value, context),
  )
  if (context.root.has("--ease-in")) problems.push("--ease-in must not exist")
  return [...problems, ...keyframeProblems(keyframes, tokens)]
}

export const motionTokens: Check = {
  id: "motion-tokens",
  run: (files) => {
    const motion = tokenFile(files, "motion.css")
    const keyframes = tokenFile(files, "keyframes.css")
    if (motion === undefined || keyframes === undefined)
      return [
        { file: `${TOKENS_DIR}motion.css`, message: "motion.css or keyframes.css is missing" },
      ]
    return motionProblems(motion, keyframes, tokenTable(files)).map(
      (message): Violation => ({ file: motion.path, message }),
    )
  },
}
