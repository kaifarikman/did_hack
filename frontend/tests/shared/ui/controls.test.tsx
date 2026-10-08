import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import ru from "@/ui/shared/i18n/locales/ru/common.json"
import { Button, CloseButton, Segmented } from "@/ui/shared/ui"

describe("Button", () => {
  it("keeps a disabled button focusable and explains why in a tooltip", () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    render(
      <Button disabled disabledReason="No run yet" onClick={onClick}>
        export
      </Button>,
    )
    const button = screen.getByRole("button", { name: "export" })
    expect(button.hasAttribute("disabled")).toBe(false)
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.dataset.disabled).toBe("true")
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.focus(button)
    act(() => vi.runAllTimers())
    expect(screen.getByRole("tooltip").textContent).toBe("No run yet")
    vi.useRealTimers()
  })

  it("stays natively disabled without a reason", () => {
    render(<Button disabled>export</Button>)
    expect(screen.getByRole("button", { name: "export" }).hasAttribute("disabled")).toBe(true)
  })

  it("defaults to a primary button of type button", () => {
    render(<Button>go</Button>)
    const button = screen.getByRole("button", { name: "go" })
    expect(button.getAttribute("type")).toBe("button")
    expect(button.dataset.variant).toBe("primary")
    expect(button.classList.contains("button")).toBe(true)
  })

  it.each(["primary", "dark", "ghost"] as const)("applies the %s variant class", (variant) => {
    render(<Button variant={variant}>go</Button>)
    expect(screen.getByRole("button").classList.contains(variant)).toBe(true)
  })

  it("renders the icon on the requested side", () => {
    render(
      <Button icon="play" iconPosition="end">
        go
      </Button>,
    )
    const button = screen.getByRole("button")
    expect(button.lastElementChild?.getAttribute("data-icon")).toBe("play")
  })

  it("blocks clicks and marks itself busy while pending", () => {
    const onClick = vi.fn()
    render(
      <Button pending onClick={onClick}>
        go
      </Button>,
    )
    const button = screen.getByRole("button")
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.querySelector("[data-icon='loader']")).not.toBeNull()
  })

  it("calls onClick when enabled", () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>go</Button>)
    fireEvent.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe("CloseButton", () => {
  it("uses the dictionary label and the close icon", () => {
    const onClick = vi.fn()
    render(<CloseButton onClick={onClick} />)
    const button = screen.getByRole("button", { name: ru.action.close })
    expect(button.querySelector("[data-icon='close']")).not.toBeNull()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

type Scenario = "easy" | "medium" | "hard"

function ScenarioSwitch({ onChange }: { readonly onChange?: (value: Scenario) => void }) {
  const [value, setValue] = useState<Scenario>("easy")
  return (
    <Segmented
      label="scenario"
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      options={[
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard", disabled: true, disabledReason: "not ready" },
      ]}
    />
  )
}

describe("Segmented", () => {
  it("renders a labelled radio group with the current value checked", () => {
    render(<ScenarioSwitch />)
    expect(screen.getByRole("group", { name: "scenario" })).toBeTruthy()
    expect((screen.getByRole("radio", { name: "Easy" }) as HTMLInputElement).checked).toBe(true)
  })

  it("selects another option and moves the indicator", () => {
    const onChange = vi.fn()
    const { container } = render(<ScenarioSwitch onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Medium" }))
    expect(onChange).toHaveBeenCalledWith("medium")
    expect(screen.getByText("Medium").closest("label")?.dataset.checked).toBe("true")
    const indicator = container.querySelector(".indicator") as HTMLElement
    expect(indicator.style.clipPath).toMatch(/^inset\(/)
  })

  it("shows a visible caption on request and keeps the group named once", () => {
    const { container } = render(
      <Segmented
        label="Robots"
        showLabel
        value="1"
        onChange={() => undefined}
        options={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
      />,
    )
    expect(screen.getByRole("group", { name: "Robots" })).toBeTruthy()
    const caption = container.querySelector(".caption")
    expect(caption?.textContent).toBe("Robots")
    expect(caption?.getAttribute("aria-hidden")).toBe("true")
    expect(container.firstElementChild?.classList).toContain("labelled")
  })

  it("disables an unavailable option and explains why", () => {
    render(<ScenarioSwitch />)
    const hard = screen.getByRole("radio", { name: "Hard" }) as HTMLInputElement
    expect(hard.disabled).toBe(true)
    expect(hard.closest("label")?.title).toBe("not ready")
  })
})
