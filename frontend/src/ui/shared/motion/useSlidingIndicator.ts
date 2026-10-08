import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { motionMs, readEasing, readPixels } from "./cssTokens"
import { prefersReducedMotion } from "./useReducedMotion"

export interface SlidingIndicator<TList extends HTMLElement> {
  readonly listRef: RefObject<TList | null>
  readonly indicatorRef: RefObject<HTMLSpanElement | null>
  readonly itemRef: (key: string) => (element: HTMLElement | null) => void
}

interface IndicatorBox {
  readonly start: number
  readonly end: number
}

interface Glide {
  readonly animation: Animation
  readonly from: IndicatorBox
  readonly to: IndicatorBox
}

export function measureIndicator(list: HTMLElement, item: HTMLElement): IndicatorBox {
  const listBox = list.getBoundingClientRect()
  const itemBox = item.getBoundingClientRect()
  const start = itemBox.left - listBox.left - list.clientLeft
  return { start, end: list.clientWidth - start - itemBox.width }
}

export function indicatorClip(box: IndicatorBox, radius: number): string {
  return `inset(0px ${box.end}px 0px ${box.start}px round ${radius}px)`
}

export function boxAt(from: IndicatorBox, to: IndicatorBox, progress: number): IndicatorBox {
  return {
    start: from.start + (to.start - from.start) * progress,
    end: from.end + (to.end - from.end) * progress,
  }
}

function currentBox(glide: Glide | null, resting: IndicatorBox | null): IndicatorBox | null {
  if (glide === null || glide.animation.playState !== "running") return resting
  const progress = glide.animation.effect?.getComputedTiming().progress
  return typeof progress === "number" ? boxAt(glide.from, glide.to, progress) : resting
}

function sameBox(first: IndicatorBox, second: IndicatorBox): boolean {
  return first.start === second.start && first.end === second.end
}

function radiusOf(indicator: HTMLElement): number {
  return readPixels("--radius-button", indicator)
}

export interface SlidingIndicatorOptions {
  readonly instant?: boolean
}

export function useSlidingIndicator<TList extends HTMLElement = HTMLDivElement>(
  activeKey: string,
  { instant = false }: SlidingIndicatorOptions = {},
): SlidingIndicator<TList> {
  const listRef = useRef<TList | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const items = useRef(new Map<string, HTMLElement>())
  const resting = useRef<IndicatorBox | null>(null)
  const glide = useRef<Glide | null>(null)
  const ready = useRef(false)

  const itemRef = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element === null) items.current.delete(key)
      else items.current.set(key, element)
    },
    [],
  )

  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    const item = items.current.get(activeKey)
    if (list === null || indicator === null || item === undefined) return
    const next = measureIndicator(list, item)
    const from = currentBox(glide.current, resting.current)
    glide.current?.animation.cancel()
    glide.current = null
    resting.current = next
    const radius = radiusOf(indicator)
    indicator.style.clipPath = indicatorClip(next, radius)
    if (from === null || sameBox(from, next) || !ready.current || instant) return
    if (prefersReducedMotion() || typeof indicator.animate !== "function") return
    const animation = indicator.animate(
      [{ clipPath: indicatorClip(from, radius) }, { clipPath: indicatorClip(next, radius) }],
      { duration: motionMs("--dur-base"), easing: readEasing("--ease-out") },
    )
    glide.current = { animation, from, to: next }
  }, [activeKey, instant])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ready.current = true
    })
    const list = listRef.current
    if (list === null || typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame)
    }
    const observer = new ResizeObserver(() => {
      const indicator = indicatorRef.current
      const item = items.current.get(activeKey)
      const gliding = glide.current?.animation.playState === "running"
      if (indicator === null || item === undefined || gliding) return
      resting.current = measureIndicator(list, item)
      indicator.style.clipPath = indicatorClip(resting.current, radiusOf(indicator))
    })
    observer.observe(list)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [activeKey])

  return { listRef, indicatorRef, itemRef }
}
