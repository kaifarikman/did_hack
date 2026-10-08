import type postcss from "postcss"
import { localProperties, referencedNames } from "../cssVars.ts"
import { type AstNode, parseScript, parseStyles, walkAst } from "../parse.ts"
import { tokenTable } from "../tokens.ts"
import {
  type Check,
  isScript,
  isSource,
  isStyle,
  type SourceFile,
  STYLES_DIR,
  type Violation,
} from "../types.ts"
import { literalStrings } from "./texts.ts"

const HOVER_MEDIA = /\(hover:\s*hover\)\s+and\s+\(pointer:\s*fine\)/
const MOTION_PACKAGES = new Set([
  "framer-motion",
  "motion",
  "gsap",
  "animejs",
  "popmotion",
  "react-spring",
  "react-motion",
  "react-transition-group",
  "velocity-animate",
  "lottie-web",
  "lottie-react",
  "@formkit/auto-animate",
])
const MOTION_SCOPES = ["@motionone/", "@react-spring/", "@lottiefiles/", "@gsap/"]
const DEPENDENCY_GROUPS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]
const REMOTE_REFERENCE =
  /(url\(\s*["']?|@import\s+["']|(?:href|src)=["']|srcset=["'][^"']*?)(https?:)?\/\//i
const REMOTE_STRING = /^(https?:)?\/\/(?!www\.w3\.org\/)/
const ACCENT_NAMES = /^--(vivid-teal|action-primary[\w-]*)$/
const TEXT_PROPERTIES = new Set([
  "color",
  "-webkit-text-fill-color",
  "text-decoration-color",
  "caret-color",
  "text-emphasis-color",
])
const FOCUS = ":focus-visible"

function violations(file: SourceFile, messages: readonly string[]): Violation[] {
  return messages.map((message) => ({ file: file.path, message }))
}

function insideHoverMedia(rule: postcss.Rule): boolean {
  let parent: postcss.Node | undefined = rule.parent as postcss.Node | undefined
  while (parent !== undefined) {
    if (parent.type === "atrule" && HOVER_MEDIA.test((parent as postcss.AtRule).params))
      return true
    parent = parent.parent as postcss.Node | undefined
  }
  return false
}

function isComponentStyle(path: string): boolean {
  return isSource(path) && (path.endsWith(".module.css") || path.startsWith(STYLES_DIR))
}

function animates(rule: postcss.Rule | undefined): boolean {
  let found = false
  rule?.walkDecls(/^(transition|animation)/, (declaration) => {
    if (declaration.value !== "none") found = true
  })
  return found
}

function focusProblems(rule: postcss.Rule, bases: ReadonlyMap<string, postcss.Rule>): string[] {
  if (!rule.selector.includes(FOCUS) || rule.selector.includes(`(${FOCUS}`)) return []
  if (animates(rule)) return [`${rule.selector} animates focus`]
  let resets = false
  let changes = false
  rule.walkDecls((declaration) => {
    if (declaration.prop === "transition" && declaration.value === "none") resets = true
    else if (!declaration.prop.startsWith("outline")) changes = true
  })
  const base = bases.get(rule.selector.replaceAll(FOCUS, ""))
  return changes && !resets && animates(base)
    ? [`${rule.selector} change is animated by its base transition`]
    : []
}

export function hoverProblems(text: string): string[] {
  const problems: string[] = []
  const root = parseStyles(text)
  const bases = new Map<string, postcss.Rule>()
  root.walkRules((rule) => {
    bases.set(rule.selector, rule)
  })
  root.walkRules((rule) => {
    if (rule.selector.includes(":hover") && !insideHoverMedia(rule))
      problems.push(`${rule.selector} hovers outside (hover: hover) and (pointer: fine)`)
    problems.push(...focusProblems(rule, bases))
  })
  return problems
}

export const hoverGate: Check = {
  id: "hover-gate",
  run: (files) =>
    files
      .filter((file) => isComponentStyle(file.path))
      .flatMap((file) => violations(file, hoverProblems(file.text))),
}

export const motionLibraries: Check = {
  id: "motion-libraries",
  run: (files) => {
    const manifest = files.find((file) => file.path === "package.json")
    if (manifest === undefined) return []
    const parsed = JSON.parse(manifest.text) as Record<
      string,
      Record<string, string> | undefined
    >
    const installed = DEPENDENCY_GROUPS.flatMap((group) => Object.keys(parsed[group] ?? {}))
    return violations(
      manifest,
      installed
        .filter(
          (name) =>
            MOTION_PACKAGES.has(name) || MOTION_SCOPES.some((scope) => name.startsWith(scope)),
        )
        .map((name) => `${name} is an animation library`),
    )
  },
}

function scriptRemoteProblems(file: SourceFile): string[] {
  const found: string[] = []
  walkAst(parseScript(file.path, file.text).program, (node: AstNode) => {
    if (node.type !== "Literal" && node.type !== "TemplateLiteral") return
    for (const text of literalStrings(node)) {
      const remote =
        REMOTE_STRING.test(text.trim()) || REMOTE_REFERENCE.test(text.replace(/^url\(/, "url("))
      if (remote) found.push(`remote asset: ${text.trim().slice(0, 80)}`)
    }
  })
  return found
}

export const remoteAssets: Check = {
  id: "remote-assets",
  run: (files) =>
    files.flatMap((file) => {
      if (isScript(file.path) && isSource(file.path))
        return violations(file, scriptRemoteProblems(file))
      if (!isStyle(file.path) && !file.path.endsWith(".html")) return []
      return violations(
        file,
        file.text
          .split(/\r?\n/)
          .filter((line) => REMOTE_REFERENCE.test(line))
          .map((line) => `remote asset: ${line.trim().slice(0, 80)}`),
      )
    }),
}

export const accentText: Check = {
  id: "accent-text",
  run: (files) => {
    const tokens = tokenTable(files)
    return files
      .filter((file) => isSource(file.path) && isStyle(file.path))
      .flatMap((file) => {
        const problems: string[] = []
        const local = localProperties(file.text)
        parseStyles(file.text).walkDecls((declaration) => {
          if (!TEXT_PROPERTIES.has(declaration.prop)) return
          const names = referencedNames(declaration.value, local, tokens)
          if ([...names].some((name) => ACCENT_NAMES.test(name)))
            problems.push(`teal used as text: ${declaration.prop}: ${declaration.value}`)
        })
        return violations(file, problems)
      })
  },
}
