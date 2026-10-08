import { type SyntheticEvent, useCallback, useEffect, useState } from "react"
import type { DurationToken } from "./cssTokens"
import { fallbackDelay } from "./fallbackDelay"

export type PresenceState = "open" | "closed"

export interface Presence {
  readonly mounted: boolean
  readonly state: PresenceState
  readonly onAnimationEnd: (event: SyntheticEvent<HTMLElement>) => void
  readonly onTransitionEnd: (event: SyntheticEvent<HTMLElement>) => void
}

export function usePresence(
  open: boolean,
  exitToken: DurationToken = "--dur-exit",
  instant = false,
): Presence {
  const [exiting, setExiting] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)

  if (wasOpen !== open) {
    setWasOpen(open)
    setExiting(!open)
  }

  useEffect(() => {
    if (!exiting) return
    const timer = window.setTimeout(
      () => setExiting(false),
      fallbackDelay(exitToken, "--reduced-fade-exit"),
    )
    return () => window.clearTimeout(timer)
  }, [exiting, exitToken])

  const onMotionEnd = useCallback(
    (event: SyntheticEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || open) return
      setExiting(false)
    },
    [open],
  )

  return {
    mounted: open || (exiting && !instant),
    state: open ? "open" : "closed",
    onAnimationEnd: onMotionEnd,
    onTransitionEnd: onMotionEnd,
  }
}
