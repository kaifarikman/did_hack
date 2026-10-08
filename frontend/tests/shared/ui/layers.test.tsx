import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { BACKEND_CONTENT_LANG, BackendText } from "@/ui/shared/i18n"
import { Button, cssZoom, LayerHost, Select, Tooltip } from "@/ui/shared/ui"

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const

describe("LayerHost", () => {
  it("renders popups inside the host instead of the body", async () => {
    render(
      <main>
        <LayerHost>
          <Select label="Scenario" value="a" options={OPTIONS} onChange={() => undefined} />
        </LayerHost>
      </main>,
    )
    await userEvent.click(screen.getByRole("combobox"))
    const host = document.querySelector("[data-layer-host]")
    expect(host?.contains(screen.getByRole("listbox"))).toBe(true)
    expect(screen.getByRole("main").contains(screen.getByRole("listbox"))).toBe(true)
  })

  it("falls back to the body without a host", async () => {
    render(
      <Tooltip content="Hint">
        <button type="button">target</button>
      </Tooltip>,
    )
    expect(document.querySelector("[data-layer-host]")).toBeNull()
  })

  it("reads the effective zoom of an element", () => {
    const zoomed = document.createElement("div")
    Object.defineProperty(zoomed, "currentCSSZoom", { value: 1.25 })
    expect([cssZoom(zoomed), cssZoom(document.body), cssZoom(null)]).toEqual([1.25, 1, 1])
  })
})

describe("Select hideLabel", () => {
  it("keeps the label for assistive technology but hides it visually", () => {
    render(
      <Select
        label="Scenario"
        value="a"
        options={OPTIONS}
        onChange={() => undefined}
        hideLabel
      />,
    )
    expect(screen.getByRole("combobox", { name: "Scenario" })).toBeTruthy()
    expect(screen.getByText("Scenario").className).toBe("visually-hidden")
  })
})

describe("Button shape", () => {
  it("rounds the dark button like the primary one unless it is a header pill", () => {
    render(
      <>
        <Button variant="dark">stop</Button>
        <Button variant="dark" shape="pill">
          menu
        </Button>
      </>,
    )
    expect(screen.getByRole("button", { name: "stop" }).className).not.toContain("pill")
    expect(screen.getByRole("button", { name: "menu" }).className).toContain("pill")
  })
})

describe("BackendText", () => {
  it("marks backend content with its language", () => {
    render(<BackendText as="p">plan</BackendText>)
    const text = screen.getByText("plan")
    expect([text.tagName, text.getAttribute("lang")]).toEqual(["P", BACKEND_CONTENT_LANG])
  })
})
