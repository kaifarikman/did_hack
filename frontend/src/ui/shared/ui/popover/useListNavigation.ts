import { useCallback, useEffect, useRef, useState } from "react"
import { motionMs } from "../../motion"

export interface ListItemInfo {
  readonly label: string
  readonly disabled?: boolean | undefined
}

export interface ListNavigation {
  readonly activeIndex: number
  readonly setActiveIndex: (index: number) => void
  readonly handleKey: (key: string) => boolean
}

const PRINTABLE = /^\S$/u

export function stepIndex(
  items: readonly ListItemInfo[],
  from: number,
  direction: 1 | -1,
): number {
  const count = items.length
  const origin = from < 0 && direction === -1 ? count : from
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((origin + direction * offset) % count) + count) % count
    if (items[index]?.disabled !== true) return index
  }
  return from
}

export function edgeIndex(items: readonly ListItemInfo[], edge: "first" | "last"): number {
  const order = items.map((_, index) => index)
  const ordered = edge === "first" ? order : order.reverse()
  return ordered.find((index) => items[index]?.disabled !== true) ?? -1
}

export function matchIndex(
  items: readonly ListItemInfo[],
  from: number,
  query: string,
): number {
  const needle = query.toLocaleLowerCase()
  const start = query.length === 1 ? from + 1 : from
  for (let offset = 0; offset < items.length; offset += 1) {
    const index = (Math.max(start, 0) + offset) % items.length
    const item = items[index]
    if (item !== undefined && item.disabled !== true) {
      if (item.label.toLocaleLowerCase().startsWith(needle)) return index
    }
  }
  return -1
}

export function useListNavigation(items: readonly ListItemInfo[]): ListNavigation {
  const [activeIndex, setActiveIndex] = useState(-1)
  const query = useRef("")
  const resetTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  const typeahead = useCallback(
    (char: string) => {
      query.current += char
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => {
        query.current = ""
      }, motionMs("--typeahead-reset"))
      const found = matchIndex(items, activeIndex, query.current)
      if (found !== -1) setActiveIndex(found)
    },
    [items, activeIndex],
  )

  const handleKey = useCallback(
    (key: string) => {
      if (key === "ArrowDown") setActiveIndex(stepIndex(items, activeIndex, 1))
      else if (key === "ArrowUp") setActiveIndex(stepIndex(items, activeIndex, -1))
      else if (key === "Home") setActiveIndex(edgeIndex(items, "first"))
      else if (key === "End") setActiveIndex(edgeIndex(items, "last"))
      else if (PRINTABLE.test(key)) typeahead(key)
      else return false
      return true
    },
    [items, activeIndex, typeahead],
  )

  return { activeIndex, setActiveIndex, handleKey }
}
