import { type DurationToken, motionMs } from "./cssTokens"
import { prefersReducedMotion } from "./useReducedMotion"

export const EXIT_FALLBACK_FACTOR = 1.5

export type ReducedFadeToken = "--reduced-fade" | "--reduced-fade-exit"

export function fallbackDelay(token: DurationToken, reducedFade: ReducedFadeToken): number {
  const duration = motionMs(token)
  const longest = prefersReducedMotion() ? Math.max(duration, motionMs(reducedFade)) : duration
  return longest * EXIT_FALLBACK_FACTOR
}
