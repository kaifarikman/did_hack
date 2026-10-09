import { type RefObject, useLayoutEffect, useState } from "react"

export const MAX_SIDE_COLUMNS = 2

export function countTracks(template: string): number {
  const tracks = template
    .trim()
    .split(/\s+/)
    .filter((track) => track !== "" && track !== "none")
  return Math.min(Math.max(tracks.length, 1), MAX_SIDE_COLUMNS)
}

export function useGridColumns(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === "undefined") return
    const sync = () => {
      if (element.getClientRects().length === 0) return
      setColumns(countTracks(getComputedStyle(element).gridTemplateColumns))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return columns
}
