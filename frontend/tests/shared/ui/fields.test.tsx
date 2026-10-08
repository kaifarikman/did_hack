import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import ru from "@/ui/shared/i18n/locales/ru/common.json"
import { Checkbox, NumberField, RadioGroup, Switch, TextArea, TextField } from "@/ui/shared/ui"
import { clampNumber, parseNumberText } from "@/ui/shared/ui/number-field"

describe("TextField", () => {
  it("labels the input and wires hint and error", () => {
    const onChange = vi.fn()
    render(<TextField label="Seed" value="" onChange={onChange} hint="hint" error="bad" />)
    const input = screen.getByLabelText("Seed")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2)
    fireEvent.change(input, { target: { value: "42" } })
    expect(onChange).toHaveBeenCalledWith("42")
  })
})

describe("TextArea", () => {
  it("grows with its content", () => {
    const { rerender } = render(
      <TextArea label="Mission" value="" onChange={() => undefined} />,
    )
    const area = screen.getByLabelText("Mission") as HTMLTextAreaElement
    Object.defineProperty(area, "scrollHeight", { configurable: true, value: 120 })
    rerender(<TextArea label="Mission" value={"a\nb\nc\nd"} onChange={() => undefined} />)
    expect(area.style.blockSize).toBe("120px")
  })
})

function Counter({ min, max }: { readonly min?: number; readonly max?: number }) {
  const [value, setValue] = useState<number | null>(1)
  return <NumberField label="Robots" value={value} onChange={setValue} min={min} max={max} />
}

describe("NumberField", () => {
  it("parses and clamps numbers", () => {
    expect(parseNumberText("3,5")).toBe(3.5)
    expect(parseNumberText("-")).toBeNull()
    expect(parseNumberText("abc")).toBeNull()
    expect(clampNumber(9, 1, 2)).toBe(2)
    expect(clampNumber(-1, 0)).toBe(0)
  })

  it("steps with its own buttons and the arrow keys within bounds", () => {
    render(<Counter min={1} max={2} />)
    const input = screen.getByLabelText("Robots") as HTMLInputElement
    expect(input.type).toBe("text")
    fireEvent.click(screen.getByRole("button", { name: ru.action.increase }))
    expect(input.value).toBe("2")
    expect(
      (screen.getByRole("button", { name: ru.action.increase }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(input.value).toBe("1")
  })

  it("ignores non-numeric typing", () => {
    render(<Counter />)
    const input = screen.getByLabelText("Robots") as HTMLInputElement
    fireEvent.change(input, { target: { value: "x" } })
    expect(input.value).toBe("1")
  })
})

describe("Checkbox, Switch and RadioGroup", () => {
  it("draws the checkbox mark through the checked state", () => {
    const onChange = vi.fn()
    const { container } = render(
      <Checkbox label="Show grid" checked={false} onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText("Show grid"))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(container.querySelector("[data-checked='false'] path")).not.toBeNull()
  })

  it("toggles a switch with role switch", () => {
    const onChange = vi.fn()
    render(<Switch label="Live" checked onChange={onChange} />)
    const control = screen.getByRole("switch", { name: "Live" })
    expect(control.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it("draws the off switch as an outline and the on switch as a filled track", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/ui/shared/ui/switch/styles.module.css"),
      "utf8",
    )
    const rule = (selector: string) =>
      css.slice(css.indexOf(`${selector} {`)).split("}")[0] ?? ""
    expect(rule(".track")).toContain("outline: var(--switch-edge) solid var(--border-strong)")
    expect(rule(".track")).toContain("background-color: var(--surface-track-off)")
    expect(rule('.switch[data-checked="true"] .track')).toContain(
      "background-color: var(--action-dark)",
    )
    expect(rule(".thumb")).toContain("background-color: var(--border-strong)")
    expect(rule('.switch[data-checked="true"] .thumb')).toContain("translateX(")
  })

  it("selects a radio option and shows the dot only for it", () => {
    const onChange = vi.fn()
    const { container } = render(
      <RadioGroup
        label="Mode"
        value="static"
        onChange={onChange}
        options={[
          { value: "static", label: "Static" },
          { value: "slam", label: "SLAM" },
        ]}
      />,
    )
    expect(screen.getByRole("group", { name: "Mode" })).toBeTruthy()
    fireEvent.click(screen.getByLabelText("SLAM"))
    expect(onChange).toHaveBeenCalledWith("slam")
    expect(container.querySelectorAll(".dot[data-on='true']")).toHaveLength(1)
  })
})
