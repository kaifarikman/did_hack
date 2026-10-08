import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fireEvent, render, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { boxAt, indicatorClip } from "@/ui/shared/motion/useSlidingIndicator"
import { Checkbox, Popover, RadioGroup, Switch } from "@/ui/shared/ui"
import { applyMotionTokens } from "../../setup/motionEnvironment"
import { ruleBody } from "../../setup/styleRules"

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), "src/ui/shared", path), "utf8")
const css = (component: string) => read(`ui/${component}/styles.module.css`)

function Layer({ open }: { readonly open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={anchorRef} type="button">
        anchor
      </button>
      <Popover open={open} onClose={() => undefined} anchorRef={anchorRef}>
        layer
      </Popover>
    </>
  )
}

describe("interruptible layers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    applyMotionTokens()
  })
  afterEach(() => vi.useRealTimers())

  it("retargets a popover reopened during its exit instead of remounting it", () => {
    const { rerender } = render(<Layer open />)
    const layer = screen.getByText("layer")
    rerender(<Layer open={false} />)
    expect(layer.dataset.state).toBe("closed")
    rerender(<Layer open />)
    expect(screen.getByText("layer")).toBe(layer)
    expect(layer.dataset.state).toBe("open")
  })

  it("unmounts a closed popover when its exit transition ends", () => {
    const { rerender } = render(<Layer open />)
    rerender(<Layer open={false} />)
    fireEvent.transitionEnd(screen.getByText("layer"))
    expect(screen.queryByText("layer")).toBeNull()
  })

  it.each(["popover", "tooltip", "banner"])(
    "%s enters and leaves through transitions",
    (name) => {
      const text = css(name)
      expect(text).toContain("@starting-style")
      expect(text).not.toMatch(/animation:/)
    },
  )
})

describe("keyboard changes do not animate", () => {
  function Choices() {
    const [checked, setChecked] = useState(false)
    const [value, setValue] = useState<"a" | "b">("a")
    return (
      <>
        <Checkbox label="grid" checked={checked} onChange={setChecked} />
        <Switch label="live" checked={checked} onChange={setChecked} />
        <RadioGroup
          label="mode"
          value={value}
          onChange={setValue}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
        />
      </>
    )
  }

  it("marks a control instant after a key and animated after a pointer", () => {
    render(<Choices />)
    const checkbox = screen.getByRole("checkbox").closest("label") as HTMLElement
    const toggle = screen.getByRole("switch")
    const group = screen.getByRole("group", { name: "mode" })
    for (const host of [checkbox, toggle, group]) {
      const target = host.querySelector("input") ?? host
      fireEvent.keyDown(target, { key: " " })
      expect(host.dataset.instant).toBe("true")
      fireEvent.pointerDown(target)
      expect(host.dataset.instant).toBe("false")
    }
  })

  it("keeps choice marks mounted so a change transitions instead of popping on render", () => {
    render(<Choices />)
    expect(document.querySelectorAll("[data-motion='fade']")).toHaveLength(2)
    expect(document.querySelectorAll("[data-on='true']")).toHaveLength(1)
    expect(css("radio-group")).toContain("composes: dot mark")
    expect(css("menu")).toContain("composes: mark")
    expect(ruleBody(read("styles/compose.module.css"), ".mark")).toContain(
      "var(--transition-mark-out)",
    )
  })

  it("turns off the instant-only transitions in tokens", () => {
    const instant = read("styles/tokens/motion.css").split('[data-instant="true"]')[1] ?? ""
    for (const token of ["--transition-draw", "--transition-thumb", "--transition-mark-in"])
      expect(instant).toContain(`${token}: none`)
  })
})

describe("motion review fixes", () => {
  it("glides the segmented indicator by clip-path and resumes from the current frame", () => {
    const from = { start: 0, end: 200 }
    const to = { start: 100, end: 100 }
    expect(boxAt(from, to, 0.5)).toEqual({ start: 50, end: 150 })
    expect(indicatorClip(to, 12)).toBe("inset(0px 100px 0px 100px round 12px)")
  })

  it("releases a press faster than it presses", () => {
    expect(read("styles/compose.module.css")).toContain("var(--transition-control-press)")
    expect(ruleBody(css("switch"), ".switch:active:not(:disabled) .thumb")).toContain(
      "var(--transition-thumb-press)",
    )
  })

  it("drops decorative motion that never shows at the moment of change", () => {
    expect(css("field")).not.toMatch(/animation/)
    expect(css("select")).not.toMatch(/animation/)
    expect(css("menu")).not.toMatch(/animation/)
  })

  it("gates the scrollbar hover reveal and fades the edges by opacity", () => {
    const scroll = css("scroll-area")
    expect(scroll).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\) \{\s+\.viewport:hover/,
    )
    expect(scroll).toContain("transition: var(--transition-fade)")
  })
})
