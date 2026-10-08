import { describe, expect, it } from "vitest"
import { layoutLayer } from "@/ui/shared/ui/popover/useAnchorPosition"
import { edgeIndex, matchIndex, stepIndex } from "@/ui/shared/ui/popover/useListNavigation"

const anchor = (top: number, left: number) =>
  ({ top, bottom: top + 40, left, right: left + 120, width: 120, height: 40 }) as DOMRect

const layout = (anchorBox: DOMRect, placement: "bottom-start" | "top-end" = "bottom-start") =>
  layoutLayer({
    anchor: anchorBox,
    layerWidth: 200,
    layerHeight: 150,
    viewportWidth: 1000,
    viewportHeight: 600,
    gap: 8,
    placement,
  })

describe("layoutLayer", () => {
  it("places the layer below the anchor with a gap", () => {
    expect(layout(anchor(100, 50))).toEqual({ top: 148, left: 50, side: "bottom" })
  })

  it("flips above when there is no room below", () => {
    expect(layout(anchor(500, 50)).side).toBe("top")
  })

  it("aligns the end and keeps the layer inside the viewport", () => {
    expect(layout(anchor(300, 10), "top-end").left).toBe(8)
    expect(layout(anchor(300, 950)).left).toBe(792)
  })
})

describe("list navigation", () => {
  const items = [{ label: "Apple" }, { label: "Banana", disabled: true }, { label: "Cherry" }]

  it("steps over disabled items and wraps", () => {
    expect(stepIndex(items, 0, 1)).toBe(2)
    expect(stepIndex(items, 2, 1)).toBe(0)
    expect(stepIndex(items, -1, -1)).toBe(2)
  })

  it("finds the first and last enabled items", () => {
    expect(edgeIndex(items, "first")).toBe(0)
    expect(edgeIndex([...items, { label: "Date", disabled: true }], "last")).toBe(2)
  })

  it("matches typed prefixes after the active item", () => {
    expect(matchIndex(items, 0, "c")).toBe(2)
    expect(matchIndex(items, 2, "a")).toBe(0)
    expect(matchIndex(items, 0, "b")).toBe(-1)
    expect(matchIndex(items, 0, "ch")).toBe(2)
  })
})
