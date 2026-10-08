import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Swap } from "@/ui/shared/motion"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"

function renderSwap(swapKey: string) {
  return (
    <Swap swapKey={swapKey}>
      <span data-testid="text">{swapKey}</span>
    </Swap>
  )
}

const host = () => screen.getByTestId("text").parentElement as HTMLElement

describe("Swap", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  it("does not animate on first render", () => {
    render(renderSwap("idle"))
    expect(host().dataset.swap).toBe("idle")
    expect(host().dataset.motion).toBe("fade")
  })

  it("lets the old content leave before the new one enters", () => {
    const { rerender } = render(renderSwap("idle"))
    rerender(renderSwap("running"))
    expect(host().dataset.swap).toBe("out")
    expect(screen.getByTestId("text").textContent).toBe("idle")
    fireEvent.animationEnd(host())
    expect(host().dataset.swap).toBe("in")
    expect(screen.getByTestId("text").textContent).toBe("running")
    fireEvent.animationEnd(host())
    expect(host().dataset.swap).toBe("idle")
  })

  it("advances by fallback timers when animations do not fire", () => {
    const { rerender } = render(renderSwap("a"))
    rerender(renderSwap("b"))
    act(() => vi.advanceTimersByTime(200))
    act(() => vi.advanceTimersByTime(300))
    expect(host().dataset.swap).toBe("idle")
    expect(screen.getByTestId("text").textContent).toBe("b")
  })

  it("lands on the latest key after rapid changes", () => {
    const { rerender } = render(renderSwap("a"))
    rerender(renderSwap("b"))
    rerender(renderSwap("c"))
    fireEvent.animationEnd(host())
    expect(screen.getByTestId("text").textContent).toBe("c")
    fireEvent.animationEnd(host())
    expect(host().dataset.swap).toBe("idle")
  })

  it.each([
    [false, "idle"],
    [true, "in"],
  ])("with reduced motion %s the entering fade is not cut short (%s)", (reduced, phase) => {
    setReducedMotion(reduced)
    for (const token of ["--dur-fast", "--dur-fast-exit"])
      document.documentElement.style.setProperty(token, "1ms")
    document.documentElement.style.setProperty("--reduced-fade", "160ms")
    document.documentElement.style.setProperty("--reduced-fade-exit", "110ms")
    const { rerender } = render(renderSwap("a"))
    rerender(renderSwap("b"))
    expect(host().dataset.motion).toBe("fade")
    act(() => vi.advanceTimersByTime(170))
    act(() => vi.advanceTimersByTime(20))
    expect(host().dataset.swap).toBe(phase)
  })
})
