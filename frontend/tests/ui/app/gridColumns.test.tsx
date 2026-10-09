import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useGridColumns } from "@/ui/app/app-layout/gridColumns"

const HIDDEN_TEMPLATE = "repeat(auto-fill, minmax(min(100%, max(416px, 50% - 12px)), 1fr))"

function observeColumns(initialTemplate: string, initiallyHidden = false) {
  const element = document.createElement("div")
  let template = initialTemplate
  let hidden = initiallyHidden
  let notify = () => {}
  const disconnect = vi.fn()
  const rectangle = new DOMRect(0, 0, 655, 800)
  vi.spyOn(element, "getClientRects").mockImplementation(() => {
    const rectangles = hidden ? [] : [rectangle]
    return Object.assign(rectangles, { item: (index: number) => rectangles[index] ?? null })
  })
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
    () => ({ gridTemplateColumns: template }) as CSSStyleDeclaration,
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    },
  )
  const reference = { current: element }
  const hook = renderHook(() => useGridColumns(reference))
  return {
    ...hook,
    disconnect,
    resize(nextTemplate: string, nextHidden = false) {
      template = nextTemplate
      hidden = nextHidden
      act(() => notify())
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("grid measurement visibility", () => {
  it("preserves the stacked journal when its workspace is hidden and restored", () => {
    const { result, resize } = observeColumns("655.586px")
    expect(result.current).toBe(1)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      resize(HIDDEN_TEMPLATE, true)
      expect(result.current).toBe(1)
      resize("655.586px")
      expect(result.current).toBe(1)
    }
  })

  it("preserves two visible columns while hidden and adapts to actual resizing", () => {
    const { result, resize } = observeColumns("655.586px")
    resize("425.5px 425.5px")
    expect(result.current).toBe(2)
    resize(HIDDEN_TEMPLATE, true)
    expect(result.current).toBe(2)
    resize("425.5px 425.5px")
    expect(result.current).toBe(2)
    resize("655.586px")
    expect(result.current).toBe(1)
  })

  it("waits for a visible measurement when first mounted in a hidden workspace", () => {
    const { result, resize, unmount, disconnect } = observeColumns(HIDDEN_TEMPLATE, true)
    expect(result.current).toBe(1)
    resize("425.5px 425.5px")
    expect(result.current).toBe(2)
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
