import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLatched, usePresence } from "@/ui/shared/motion"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"

function Panel({ open, label }: { readonly open: boolean; readonly label: string }) {
  const presence = usePresence(open)
  const shown = useLatched(label, open)
  if (!presence.mounted) return null
  return (
    <div
      data-testid="panel"
      data-state={presence.state}
      onAnimationEnd={presence.onAnimationEnd}
    >
      {shown}
    </div>
  )
}

describe("usePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  it("mounts immediately and reports the open state", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    })
    expect(result.current.mounted).toBe(false)
    rerender({ open: true })
    expect(result.current).toMatchObject({ mounted: true, state: "open" })
  })

  it("keeps the element during exit and unmounts on animationend", () => {
    const { rerender } = render(<Panel open label="a" />)
    rerender(<Panel open={false} label="b" />)
    const panel = screen.getByTestId("panel")
    expect(panel.dataset.state).toBe("closed")
    expect(panel.textContent).toBe("a")
    fireEvent.animationEnd(panel)
    expect(screen.queryByTestId("panel")).toBeNull()
  })

  it("unmounts by the fallback timer when no animation runs", () => {
    const { rerender } = render(<Panel open label="a" />)
    rerender(<Panel open={false} label="a" />)
    expect(screen.getByTestId("panel")).toBeTruthy()
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByTestId("panel")).toBeNull()
  })

  it("ignores animationend from children", () => {
    const { rerender } = render(<Panel open label="a" />)
    rerender(<Panel open={false} label="a" />)
    const panel = screen.getByTestId("panel")
    const child = document.createElement("span")
    panel.append(child)
    fireEvent.animationEnd(child)
    expect(screen.getByTestId("panel")).toBeTruthy()
  })

  it.each([
    [false, 2, true],
    [true, 2, false],
    [true, 170, true],
  ])("with reduced motion %s the exit is gone after %ims: %s", (reduced, waited, gone) => {
    setReducedMotion(reduced)
    document.documentElement.style.setProperty("--dur-exit", "1ms")
    document.documentElement.style.setProperty("--reduced-fade-exit", "110ms")
    const { rerender } = render(<Panel open label="a" />)
    rerender(<Panel open={false} label="a" />)
    act(() => vi.advanceTimersByTime(waited))
    expect(screen.queryByTestId("panel") === null).toBe(gone)
  })
})

describe("useLatched", () => {
  it("returns the live value while open and the last value when closed", () => {
    const { result, rerender } = renderHook(({ value, open }) => useLatched(value, open), {
      initialProps: { value: "first", open: true },
    })
    rerender({ value: "second", open: true })
    expect(result.current).toBe("second")
    rerender({ value: "third", open: false })
    expect(result.current).toBe("second")
  })
})
