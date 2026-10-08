import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDetailsMotion, useLoadingIndicator, withViewTransition } from "@/ui/shared/motion"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"

type StartViewTransition = (update: () => void) => ViewTransition

function installViewTransition(): ReturnType<typeof vi.fn<StartViewTransition>> {
  const start = vi.fn<StartViewTransition>((update) => {
    update()
    return {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition: vi.fn(),
      types: new Set<string>(),
    } as unknown as ViewTransition
  })
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start })
  return start
}

describe("withViewTransition", () => {
  afterEach(() => Reflect.deleteProperty(document, "startViewTransition"))

  it("applies the change directly without the API", async () => {
    const change = vi.fn()
    await withViewTransition("mission", change)
    expect(change).toHaveBeenCalledOnce()
  })

  it("wraps the change and marks the mode while running", async () => {
    const start = installViewTransition()
    let modeDuringChange: string | undefined
    await withViewTransition("mission", () => {
      modeDuringChange = document.documentElement.dataset.viewTransition
    })
    expect(start).toHaveBeenCalledOnce()
    expect(modeDuringChange).toBe("mission")
    expect(document.documentElement.dataset.viewTransition).toBeUndefined()
  })

  it("keeps the mode of a newer transition when an older one finishes", async () => {
    const finishes: (() => void)[] = []
    const start = vi.fn<StartViewTransition>((update) => {
      update()
      const finished = new Promise<undefined>((resolve) =>
        finishes.push(() => resolve(undefined)),
      )
      return {
        finished,
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
        types: new Set<string>(),
      } as unknown as ViewTransition
    })
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start })
    const first = withViewTransition("mission", () => undefined)
    const second = withViewTransition("layout", () => undefined)
    finishes[0]?.()
    await first
    expect(document.documentElement.dataset.viewTransition).toBe("layout")
    finishes[1]?.()
    await second
    expect(document.documentElement.dataset.viewTransition).toBeUndefined()
  })

  it("passes on an error thrown by the change", async () => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        const done = Promise.resolve().then(update)
        return {
          finished: done.catch(() => undefined),
          ready: Promise.resolve(),
          updateCallbackDone: done,
          skipTransition: vi.fn(),
        }
      },
    })
    await expect(
      withViewTransition("mission", () => {
        throw new Error("change failed")
      }),
    ).rejects.toThrow("change failed")
  })

  it("skips the transition under reduced motion", async () => {
    setReducedMotion(true)
    const start = installViewTransition()
    const change = vi.fn()
    await withViewTransition("layout", change)
    expect(change).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })
})

describe("useLoadingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  const setup = (pending: boolean, hasData: boolean) =>
    renderHook((props) => useLoadingIndicator(props), { initialProps: { pending, hasData } })

  it("shows nothing for fast loads", () => {
    const { result, rerender } = setup(true, false)
    act(() => vi.advanceTimersByTime(150))
    rerender({ pending: false, hasData: true })
    expect(result.current).toBe("none")
  })

  it("shows a skeleton after the delay and holds it", () => {
    const { result, rerender } = setup(true, false)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe("skeleton")
    rerender({ pending: false, hasData: true })
    expect(result.current).toBe("skeleton")
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe("none")
  })

  it("dims stale data and adds a spinner for long refreshes", () => {
    const { result } = setup(true, true)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe("stale")
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe("spinner")
  })
})

function Details() {
  const motion = useDetailsMotion()
  return (
    <details ref={motion.detailsRef} data-testid="details">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is natively interactive */}
      <summary onClick={motion.onSummaryClick}>summary</summary>
      <div ref={motion.contentRef} data-state={motion.state} data-testid="content" />
    </details>
  )
}

describe("useDetailsMotion", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  const details = () => screen.getByTestId("details") as HTMLDetailsElement

  it("opens at once and closes after the exit transition", () => {
    render(<Details />)
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    expect(details().open).toBe(true)
    expect(screen.getByTestId("content").dataset.state).toBe("open")
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    expect(screen.getByTestId("content").dataset.state).toBe("closed")
    expect(details().open).toBe(true)
    fireEvent.transitionEnd(screen.getByTestId("content"))
    expect(details().open).toBe(false)
  })

  it("reopens from the middle of the exit instead of closing again", () => {
    render(<Details />)
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    expect(screen.getByTestId("content").dataset.state).toBe("open")
    vi.runAllTimers()
    expect(details().open).toBe(true)
  })

  it("closes without animation from the keyboard", () => {
    render(<Details />)
    fireEvent.click(screen.getByText("summary"), { detail: 1 })
    fireEvent.click(screen.getByText("summary"), { detail: 0 })
    expect(details().open).toBe(false)
  })
})
