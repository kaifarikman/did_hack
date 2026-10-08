import { flushSync } from "react-dom"
import { motionMs } from "./cssTokens"
import { prefersReducedMotion } from "./useReducedMotion"

export type ViewTransitionMode = "mission" | "layout"

let latestTransition = 0

export async function withViewTransition(
  mode: ViewTransitionMode,
  change: () => void,
): Promise<void> {
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    change()
    return
  }
  const root = document.documentElement
  latestTransition += 1
  const owner = latestTransition
  root.dataset.viewTransition = mode
  const transition = document.startViewTransition(() => flushSync(change))
  const limit = window.setTimeout(
    () => transition.skipTransition(),
    motionMs("--view-transition-limit"),
  )
  try {
    await transition.updateCallbackDone
    await transition.finished.catch(() => undefined)
  } finally {
    window.clearTimeout(limit)
    if (owner === latestTransition) delete root.dataset.viewTransition
  }
}
