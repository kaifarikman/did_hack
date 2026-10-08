import { motionMs } from "./cssTokens"
import { prefersReducedMotion } from "./useReducedMotion"

export function settleDelay(): number {
  return prefersReducedMotion() ? 0 : motionMs("--delay-settle")
}
