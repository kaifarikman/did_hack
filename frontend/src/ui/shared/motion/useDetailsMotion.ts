import {
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { fallbackDelay } from "./fallbackDelay"
import type { PresenceState } from "./usePresence"

export interface DetailsMotion {
  readonly detailsRef: RefObject<HTMLDetailsElement | null>
  readonly contentRef: RefObject<HTMLDivElement | null>
  readonly state: PresenceState
  readonly instant: boolean
  readonly onSummaryClick: (event: MouseEvent<HTMLElement>) => void
}

const KEYBOARD_CLICK_DETAIL = 0

export function useDetailsMotion(defaultOpen = false): DetailsMotion {
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<PresenceState>(defaultOpen ? "open" : "closed")
  const [instant, setInstant] = useState(false)

  useEffect(() => {
    if (defaultOpen && detailsRef.current !== null) detailsRef.current.open = true
  }, [defaultOpen])

  const onSummaryClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const details = detailsRef.current
      if (details === null) return
      event.preventDefault()
      const viaKeyboard = event.detail === KEYBOARD_CLICK_DETAIL
      setInstant(viaKeyboard)
      if (state === "closed") {
        details.open = true
        contentRef.current?.getBoundingClientRect()
        setState("open")
        return
      }
      setState("closed")
      if (viaKeyboard) details.open = false
    },
    [state],
  )

  useEffect(() => {
    const details = detailsRef.current
    const content = contentRef.current
    if (state !== "closed" || details === null || !details.open) return
    const close = () => {
      details.open = false
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === content) close()
    }
    content?.addEventListener("transitionend", onEnd)
    const timer = window.setTimeout(
      close,
      fallbackDelay("--dur-panel-exit", "--reduced-fade-exit"),
    )
    return () => {
      content?.removeEventListener("transitionend", onEnd)
      window.clearTimeout(timer)
    }
  }, [state])

  return { detailsRef, contentRef, state, instant, onSummaryClick }
}
