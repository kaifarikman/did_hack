import { type RefObject, useLayoutEffect, useState } from "react"
import { readPixels } from "../../motion"
import { matchZoom } from "../layer-host"

export type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end"

export type Side = "top" | "bottom"

interface AnchoredLayout {
  readonly top: number
  readonly left: number
  readonly side: Side
}

interface LayoutInput {
  readonly anchor: DOMRect
  readonly layerWidth: number
  readonly layerHeight: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly gap: number
  readonly placement: Placement
}

export function layoutLayer(input: LayoutInput): AnchoredLayout {
  const { anchor, layerWidth, layerHeight, viewportWidth, viewportHeight, gap, placement } =
    input
  const preferred: Side = placement.startsWith("top") ? "top" : "bottom"
  const fitsBelow = anchor.bottom + gap + layerHeight <= viewportHeight
  const fitsAbove = anchor.top - gap - layerHeight >= 0
  const side: Side =
    preferred === "bottom"
      ? fitsBelow || !fitsAbove
        ? "bottom"
        : "top"
      : fitsAbove || !fitsBelow
        ? "top"
        : "bottom"
  const top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - layerHeight
  const alignedLeft = placement.endsWith("end") ? anchor.right - layerWidth : anchor.left
  const left = Math.max(gap, Math.min(alignedLeft, viewportWidth - layerWidth - gap))
  return { top, left, side }
}

export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
  active: boolean,
  placement: Placement,
  matchAnchorWidth: boolean,
): Side {
  const [side, setSide] = useState<Side>(placement.startsWith("top") ? "top" : "bottom")

  useLayoutEffect(() => {
    if (!active) return
    const place = () => {
      const anchor = anchorRef.current
      const layer = layerRef.current
      if (anchor === null || layer === null) return
      const zoom = matchZoom(layer, anchor)
      const anchorBox = anchor.getBoundingClientRect()
      if (matchAnchorWidth) layer.style.minInlineSize = `${anchorBox.width / zoom}px`
      const layout = layoutLayer({
        anchor: anchorBox,
        layerWidth: layer.offsetWidth * zoom,
        layerHeight: layer.offsetHeight * zoom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gap: readPixels("--popover-gap") * zoom,
        placement,
      })
      layer.style.top = `${layout.top / zoom}px`
      layer.style.left = `${layout.left / zoom}px`
      setSide(layout.side)
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [active, anchorRef, layerRef, placement, matchAnchorWidth])

  return side
}
