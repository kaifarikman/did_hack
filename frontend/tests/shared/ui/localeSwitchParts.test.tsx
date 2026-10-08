import { act, fireEvent, render, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { settleDelay } from "@/ui/shared/motion"
import { Button, Flag, MenuItemRadio, MenuList } from "@/ui/shared/ui"
import { nextIndex } from "@/ui/shared/ui/menu"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"

function LanguageMenu({ onPick }: { readonly onPick?: (value: string) => void }) {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState("ru")
  const trigger = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <Button ref={trigger} size="icon" variant="ghost" icon="globe" aria-expanded={open}>
        language
      </Button>
      <MenuList
        id="languages"
        open={open}
        label="Languages"
        anchorRef={trigger}
        onClose={() => setOpen(false)}
      >
        {["ru", "en"].map((code) => (
          <MenuItemRadio
            key={code}
            checked={code === value}
            onSelect={() => {
              setValue(code)
              onPick?.(code)
            }}
          >
            <Flag code={code === "ru" ? "ru" : "gb"} />
            <span lang={code}>{code}</span>
          </MenuItemRadio>
        ))}
      </MenuList>
    </>
  )
}

describe("Flag", () => {
  it("renders a decorative 20x15 image per code", () => {
    const { container } = render(<Flag code="gb" />)
    const image = container.querySelector("img") as HTMLImageElement
    expect(image.alt).toBe("")
    expect(image.width).toBe(20)
    expect(image.height).toBe(15)
    expect(image.getAttribute("src")).toContain("gb")
  })
})

describe("icon Button", () => {
  it("is a square button with a hidden text name", () => {
    render(
      <Button size="icon" icon="globe" variant="ghost">
        language
      </Button>,
    )
    const button = screen.getByRole("button", { name: "language" })
    expect(button.classList).toContain("iconOnly")
    expect(screen.getByText("language").className).toBe("visually-hidden")
  })
})

describe("MenuList and MenuItemRadio", () => {
  it("focuses the checked item and marks it with a check", () => {
    render(<LanguageMenu />)
    const checked = screen.getByRole("menuitemradio", { checked: true })
    expect(document.activeElement).toBe(checked)
    expect(checked.querySelector("[data-icon='check']")).not.toBeNull()
    expect(screen.getByRole("menu", { name: "Languages" })).toBeTruthy()
  })

  it("moves focus with arrows and selects", () => {
    const onPick = vi.fn()
    render(<LanguageMenu onPick={onPick} />)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("en")
    fireEvent.click(document.activeElement as HTMLElement)
    expect(onPick).toHaveBeenCalledWith("en")
    expect(screen.getByRole("menuitemradio", { checked: true }).textContent).toBe("en")
  })

  it("places the checked indicator through transform and enables its glide after a frame", async () => {
    render(<LanguageMenu />)
    const menu = screen.getByRole("menu")
    const indicator = menu.querySelector(".indicator") as HTMLElement
    expect(menu.dataset.indicator).toBe("placed")
    expect(indicator.style.transform).toMatch(/^translateY\(/)
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(menu.dataset.indicator).toBe("ready")
  })

  it("computes keyboard targets", () => {
    expect(nextIndex("ArrowDown", 1, 2)).toBe(0)
    expect(nextIndex("ArrowUp", 0, 2)).toBe(1)
    expect(nextIndex("End", 0, 3)).toBe(2)
    expect(nextIndex("x", 0, 3)).toBeNull()
  })
})

describe("settleDelay", () => {
  afterEach(() => vi.useRealTimers())

  it("reads the settle delay token and drops it under reduced motion", () => {
    applyMotionTokens()
    expect(settleDelay()).toBe(220)
    setReducedMotion(true)
    expect(settleDelay()).toBe(0)
  })
})
