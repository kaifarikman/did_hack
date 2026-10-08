import {
  cloneElement,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { motionMs, usePresence } from "../../motion"
import { useLayerHost } from "../layer-host"
import { type Placement, useAnchorPosition } from "../popover/useAnchorPosition"
import styles from "./styles.module.css"

interface TriggerProps {
  readonly "aria-describedby"?: string | undefined
  readonly onPointerEnter?: ((event: PointerEvent<HTMLElement>) => void) | undefined
  readonly onPointerLeave?: ((event: PointerEvent<HTMLElement>) => void) | undefined
  readonly onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined
  readonly onBlur?: ((event: FocusEvent<HTMLElement>) => void) | undefined
  readonly ref?: unknown
}

export interface TooltipProps {
  readonly content: string
  readonly side?: "top" | "bottom" | undefined
  readonly children: ReactElement<TriggerProps>
}

const SIDE_PLACEMENT: Readonly<Record<"top" | "bottom", Placement>> = {
  top: "top-start",
  bottom: "bottom-start",
}

let lastHiddenAt = Number.NEGATIVE_INFINITY

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const host = useLayerHost()
  const timer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const presence = usePresence(open, "--dur-fast-exit")
  const resolvedSide = useAnchorPosition(
    anchorRef,
    layerRef,
    presence.mounted,
    SIDE_PLACEMENT[side],
    false,
  )

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => clear, [clear])

  const show = () => {
    clear()
    const delay = motionMs("--delay-tooltip")
    const skipDelay = performance.now() - lastHiddenAt < delay
    setInstant(skipDelay)
    if (skipDelay) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = useCallback(() => {
    clear()
    if (open) lastHiddenAt = performance.now()
    setOpen(false)
  }, [clear, open])
  const hideSoon = () => {
    clear()
    timer.current = window.setTimeout(hide, motionMs("--delay-hover-grace"))
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, hide])

  const trigger = cloneElement(children, {
    ref: (element: HTMLElement | null) => {
      anchorRef.current = element
    },
    "aria-describedby": open ? id : children.props["aria-describedby"],
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      children.props.onPointerEnter?.(event)
      show()
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      children.props.onPointerLeave?.(event)
      hideSoon()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event)
      show()
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event)
      hide()
    },
  })

  return (
    <>
      {trigger}
      {presence.mounted
        ? createPortal(
            <div
              ref={layerRef}
              id={id}
              role="tooltip"
              className={styles.tooltip}
              data-state={presence.state}
              data-side={resolvedSide}
              data-instant={instant}
              data-motion="fade"
              onPointerEnter={clear}
              onPointerLeave={hideSoon}
              onTransitionEnd={presence.onTransitionEnd}
            >
              {content}
            </div>,
            host,
          )
        : null}
    </>
  )
}
