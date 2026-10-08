import { clsx } from "clsx"
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { motionMs } from "../../motion"
import styles from "./styles.module.css"

export type ScrollSurface = "card" | "tint" | "canvas"

export interface ScrollAreaProps {
  readonly label?: string | undefined
  readonly surface?: ScrollSurface | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}

const SURFACE_CLASS: Readonly<Record<ScrollSurface, string | undefined>> = {
  card: undefined,
  tint: styles.tint,
  canvas: styles.canvas,
}

const EDGE_TOLERANCE = 1

export function readEdges(viewport: HTMLElement): { atStart: boolean; atEnd: boolean } {
  const atStart = viewport.scrollTop <= EDGE_TOLERANCE
  const atEnd =
    viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - EDGE_TOLERANCE
  return { atStart, atEnd }
}

export function ScrollArea({ label, surface = "card", className, children }: ScrollAreaProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)

  const syncEdges = useCallback(() => {
    const root = rootRef.current
    const viewport = viewportRef.current
    if (root === null || viewport === null) return
    const { atStart, atEnd } = readEdges(viewport)
    root.dataset.atStart = String(atStart)
    root.dataset.atEnd = String(atEnd)
  }, [])

  useLayoutEffect(() => {
    syncEdges()
    const viewport = viewportRef.current
    if (viewport === null || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(syncEdges)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [syncEdges])

  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    },
    [],
  )

  const onScroll = () => {
    syncEdges()
    const root = rootRef.current
    if (root === null) return
    root.dataset.scrolling = "true"
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      root.dataset.scrolling = "false"
    }, motionMs("--delay-scrollbar-hide"))
  }

  return (
    <div ref={rootRef} className={clsx(styles.root, SURFACE_CLASS[surface], className)}>
      <section
        ref={viewportRef}
        className={styles.viewport}
        aria-label={label}
        tabIndex={label === undefined ? undefined : 0}
        onScroll={onScroll}
      >
        {children}
      </section>
      <span className={styles.fadeStart} aria-hidden="true" />
      <span className={styles.fadeEnd} aria-hidden="true" />
    </div>
  )
}
