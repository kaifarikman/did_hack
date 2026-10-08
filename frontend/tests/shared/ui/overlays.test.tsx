import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ru from "@/ui/shared/i18n/locales/ru/common.json"
import { Button, Dialog, Menu, Select, Tooltip } from "@/ui/shared/ui"
import { applyMotionTokens } from "../../setup/motionEnvironment"

type Fruit = "apple" | "banana" | "cherry"

function FruitSelect() {
  const [value, setValue] = useState<Fruit>("apple")
  return (
    <Select
      label="Fruit"
      value={value}
      onChange={setValue}
      options={[
        { value: "apple", label: "Apple" },
        { value: "banana", label: "Banana", disabled: true },
        { value: "cherry", label: "Cherry" },
      ]}
    />
  )
}

const combobox = () => screen.getByRole("combobox", { name: "Fruit" })

describe("Select", () => {
  it("opens a listbox from the keyboard and marks the selected option", () => {
    render(<FruitSelect />)
    fireEvent.keyDown(combobox(), { key: "ArrowDown" })
    expect(combobox().getAttribute("aria-expanded")).toBe("true")
    const listbox = screen.getByRole("listbox")
    expect(listbox.getAttribute("aria-labelledby")).toBeTruthy()
    const selected = screen.getByRole("option", { name: "Apple" })
    expect(selected.getAttribute("aria-selected")).toBe("true")
    expect(selected.querySelector("[data-icon='check']")).not.toBeNull()
    expect(
      screen.getByRole("listbox").closest<HTMLElement>("[data-state]")?.dataset.state,
    ).toBe("open")
  })

  it("skips disabled options, selects with Enter and closes", () => {
    render(<FruitSelect />)
    fireEvent.keyDown(combobox(), { key: "Enter" })
    fireEvent.keyDown(combobox(), { key: "ArrowDown" })
    expect(combobox().getAttribute("aria-activedescendant")).toContain("option-2")
    fireEvent.keyDown(combobox(), { key: "Enter" })
    expect(combobox().textContent).toContain("Cherry")
    expect(combobox().getAttribute("aria-expanded")).toBe("false")
  })

  it("jumps by typed letters and to the ends with Home and End", () => {
    render(<FruitSelect />)
    fireEvent.keyDown(combobox(), { key: "ArrowDown" })
    fireEvent.keyDown(combobox(), { key: "c" })
    expect(combobox().getAttribute("aria-activedescendant")).toContain("option-2")
    fireEvent.keyDown(combobox(), { key: "Home" })
    expect(combobox().getAttribute("aria-activedescendant")).toContain("option-0")
  })

  it("does not animate a list opened and closed from the keyboard", () => {
    render(<FruitSelect />)
    fireEvent.keyDown(combobox(), { key: "ArrowDown" })
    expect(
      screen.getByRole("listbox").closest<HTMLElement>("[data-state]")?.dataset.instant,
    ).toBe("true")
    fireEvent.keyDown(combobox(), { key: "Enter" })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("animates a list opened with the pointer", () => {
    render(<FruitSelect />)
    fireEvent.pointerDown(combobox())
    fireEvent.click(combobox())
    expect(
      screen.getByRole("listbox").closest<HTMLElement>("[data-state]")?.dataset.instant,
    ).toBe("false")
  })

  it("closes on Escape without changing the value", () => {
    render(<FruitSelect />)
    fireEvent.click(combobox())
    fireEvent.keyDown(document, { key: "Escape" })
    expect(combobox().getAttribute("aria-expanded")).toBe("false")
    expect(combobox().textContent).toContain("Apple")
  })
})

describe("Menu", () => {
  it("moves focus through items and runs the chosen action", () => {
    const onExport = vi.fn()
    render(
      <Menu
        items={[
          { id: "a", label: "Export", onSelect: onExport },
          { id: "b", label: "Reset", onSelect: () => undefined },
        ]}
      />,
    )
    const trigger = screen.getByRole("button", { name: ru.action.more })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Export")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" })
    expect(document.activeElement?.textContent).toBe("Reset")
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }))
    expect(onExport).toHaveBeenCalledOnce()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })
})

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  it("appears after the delay and describes its trigger", () => {
    render(
      <Tooltip content="More info">
        <Button>info</Button>
      </Tooltip>,
    )
    const trigger = screen.getByRole("button", { name: "info" })
    fireEvent.pointerEnter(trigger)
    expect(screen.queryByRole("tooltip")).toBeNull()
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByRole("tooltip").textContent).toBe("More info")
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id)
    fireEvent.pointerLeave(trigger)
    fireEvent.pointerEnter(screen.getByRole("tooltip"))
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByRole("tooltip").dataset.state).toBe("open")
    fireEvent.pointerLeave(screen.getByRole("tooltip"))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole("tooltip").dataset.state).toBe("closed")
  })

  it("closes on Escape while the pointer stays on the trigger", () => {
    render(
      <Tooltip content="More info">
        <Button>info</Button>
      </Tooltip>,
    )
    fireEvent.focus(screen.getByRole("button", { name: "info" }))
    act(() => vi.advanceTimersByTime(400))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("tooltip").dataset.state).toBe("closed")
  })
})

describe("Dialog", () => {
  it("renders a labelled modal with scrim and panel motion and closes on cancel", () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open title="Export" description="Choose" onClose={onClose}>
        body
      </Dialog>,
    )
    const dialog = document.querySelector("dialog") as HTMLDialogElement
    expect(dialog.dataset.state).toBe("open")
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy()
    expect(document.activeElement?.tagName).toBe("SECTION")
    fireEvent(dialog, new Event("cancel", { cancelable: true }))
    expect(onClose).toHaveBeenCalledOnce()
    rerender(
      <Dialog open={false} title="Export" onClose={onClose}>
        body
      </Dialog>,
    )
    expect(dialog.dataset.state).toBe("closed")
  })

  it("closes from the close button and from the scrim", () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Export" onClose={onClose}>
        body
      </Dialog>,
    )
    fireEvent.click(screen.getByRole("button", { name: ru.action.close }))
    fireEvent.click(document.querySelector("dialog > [aria-hidden='true']") as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
