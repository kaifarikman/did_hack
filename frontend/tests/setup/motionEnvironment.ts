import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const MOTION_CSS = resolve(process.cwd(), "src/ui/shared/styles/tokens/motion.css")

const ROOT_DECLARATION = /^\s*(--[\w-]+):\s*([^;]+);/gm

export function rootMotionTokens(): ReadonlyMap<string, string> {
  const css = readFileSync(MOTION_CSS, "utf8")
  const rootBlock = css.slice(0, css.indexOf("@media"))
  return new Map(
    [...rootBlock.matchAll(ROOT_DECLARATION)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  )
}

export function applyMotionTokens(): void {
  for (const [token, value] of rootMotionTokens()) {
    document.documentElement.style.setProperty(token, value)
  }
}

export function setReducedMotion(reduced: boolean): void {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  })
}

export function resetMotionEnvironment(): void {
  document.documentElement.removeAttribute("style")
  Reflect.deleteProperty(window, "matchMedia")
}
