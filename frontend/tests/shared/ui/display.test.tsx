import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ru from "@/ui/shared/i18n/locales/ru/common.json"
import { Banner, Card, Eyebrow, Icon, Meter, NoValue, Stat, StatusBadge } from "@/ui/shared/ui"

describe("Icon", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Icon name="robot" />)
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("is an image with a label", () => {
    render(<Icon name="hazard" label="hazard" />)
    expect(screen.getByRole("img", { name: "hazard" })).toBeTruthy()
  })
})

describe("Card", () => {
  it("renders the requested level and element", () => {
    render(
      <Card as="article" level="inner" aria-label="card">
        body
      </Card>,
    )
    const card = screen.getByRole("article", { name: "card" })
    expect(card.dataset.level).toBe("inner")
    expect(card.classList.contains("inner")).toBe(true)
  })

  it("enters with a stagger index and a reduced-motion fade", () => {
    render(<Card motionIndex={2}>body</Card>)
    const card = screen.getByText("body")
    expect(card.dataset.motion).toBe("fade")
    expect(card.style.getPropertyValue("--i")).toBe("2")
    expect(card.classList.contains("entering")).toBe(true)
  })
})

describe("Card title", () => {
  it("labels a top card with an h2 and puts the eyebrow above it", () => {
    render(
      <Card title="Mission" eyebrow="Run" actions={<span>action</span>}>
        body
      </Card>,
    )
    const heading = screen.getByRole("heading", { level: 2, name: "Mission" })
    expect(screen.getByRole("region", { name: "Mission" })).toBeTruthy()
    expect(heading.classList).toContain("title")
    expect(heading.classList).not.toContain("eyebrow")
    const group = heading.parentElement
    expect(group?.tagName).toBe("HGROUP")
    expect(group?.firstElementChild?.textContent).toBe("Run")
    expect(screen.getByText("action").parentElement?.classList).toContain("actions")
  })

  it("uses h3 for inner cards and keeps an explicit title id", () => {
    render(
      <Card level="inner" as="article" title="Summary" titleId="summary-title">
        body
      </Card>,
    )
    const card = screen.getByRole("article", { name: "Summary" })
    expect(card.getAttribute("aria-labelledby")).toBe("summary-title")
    expect(screen.getByRole("heading", { level: 3 }).id).toBe("summary-title")
  })

  it("gives every titled card its own heading id", () => {
    render(
      <>
        <Card title="One">a</Card>
        <Card title="Two">b</Card>
      </>,
    )
    const [first, second] = screen.getAllByRole("region")
    expect(first?.getAttribute("aria-labelledby")).not.toBe(
      second?.getAttribute("aria-labelledby"),
    )
  })

  it("stays unlabelled without a title and respects an explicit aria-label", () => {
    const { container } = render(<Card>plain</Card>)
    expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false)
    render(
      <Card title="Shown" aria-label="Named">
        body
      </Card>,
    )
    expect(screen.getByRole("region", { name: "Named" })).toBeTruthy()
  })
})

describe("Eyebrow", () => {
  it("renders as the requested element", () => {
    render(<Eyebrow as="h2">section</Eyebrow>)
    expect(screen.getByRole("heading", { name: "section" }).classList).toContain("eyebrow")
  })
})

describe("StatusBadge", () => {
  it.each([
    ["positive", "check"],
    ["attention", "alert"],
    ["critical", "critical"],
  ] as const)("shows an icon for %s, not only a color", (tone, icon) => {
    render(<StatusBadge tone={tone}>state</StatusBadge>)
    const badge = screen.getByText("state").closest("[data-tone]") as HTMLElement
    expect(badge.querySelector(`[data-icon='${icon}']`)).not.toBeNull()
  })

  it("shows a pulsing dot when live", () => {
    const { container } = render(
      <StatusBadge tone="progress" live>
        running
      </StatusBadge>,
    )
    expect(container.querySelector("[data-marker='pulse']")).not.toBeNull()
  })

  it("shows a running state as a pulse, not an endless spinner", () => {
    const { container } = render(<StatusBadge tone="progress">running</StatusBadge>)
    expect(container.querySelector("[data-marker='pulse']")).not.toBeNull()
    expect(container.querySelector("[data-icon='loader']")).toBeNull()
  })

  it.each(["neutral", "positive", "attention", "critical"] as const)(
    "draws %s as the same mint badge without an outline or dark fill",
    (tone) => {
      render(<StatusBadge tone={tone}>state</StatusBadge>)
      const badge = screen.getByText("state").closest("[data-tone]") as HTMLElement
      expect(badge.className).toContain("badge")
      expect(badge.className).not.toMatch(/attention|critical/)
    },
  )

  it("changes its label through Swap", () => {
    const { rerender } = render(
      <StatusBadge tone="progress" swapKey="starting">
        starting
      </StatusBadge>,
    )
    rerender(
      <StatusBadge tone="progress" swapKey="running">
        running
      </StatusBadge>,
    )
    expect(screen.getByText("starting").closest("[data-swap]")?.getAttribute("data-swap")).toBe(
      "out",
    )
  })
})

describe("Stat and NoValue", () => {
  it("renders a tabular value with its unit", () => {
    render(<Stat label="battery" value="82" unit="%" />)
    expect(screen.getByText("82").classList).toContain("value")
    expect(screen.getByText("%")).toBeTruthy()
  })

  it("renders the shared dash for a missing value", () => {
    render(<Stat label="signal" value={null} />)
    expect(screen.getByText(ru.value.none)).toBeTruthy()
    expect(screen.getByText(ru.value.noneLabel)).toBeTruthy()
  })

  it("marks attention with an icon", () => {
    render(<Stat label="battery" value="9" tone="attention" />)
    expect(screen.getByRole("img", { name: ru.status.attention })).toBeTruthy()
  })

  it("accepts a custom label for the dash", () => {
    render(<NoValue label="no signal" />)
    expect(screen.getByText("no signal")).toBeTruthy()
  })
})

describe("Meter", () => {
  it("exposes a native meter and scales the fill", () => {
    const { container } = render(<Meter label="battery" value={0.4} valueText="40%" />)
    const meter = container.querySelector("meter") as HTMLMeterElement
    expect(meter.value).toBe(0.4)
    expect(meter.getAttribute("aria-valuetext")).toBe("40%")
    const fill = container.querySelector(".fill") as HTMLElement
    expect(fill.style.getPropertyValue("--meter-value")).toBe("0.4")
  })

  it("clamps out-of-range values and draws the threshold", () => {
    const { container } = render(
      <Meter label="battery" value={1.7} valueText="full" threshold={0.25} />,
    )
    expect((container.querySelector("meter") as HTMLMeterElement).value).toBe(1)
    const marker = container.querySelector(".threshold") as HTMLElement
    expect(marker.title).toBe(ru.meter.threshold)
  })

  it("flashes once when the tone becomes critical", () => {
    const { container, rerender } = render(<Meter label="b" value={0.5} valueText="50%" />)
    expect(container.querySelector(".flash")).toBeNull()
    rerender(<Meter label="b" value={0.1} valueText="10%" tone="critical" />)
    expect(container.querySelector(".flash")).not.toBeNull()
    expect(container.querySelector("[data-icon='critical']")).not.toBeNull()
  })
})

describe("Banner", () => {
  it("keeps the action in the wrapping row next to the text", () => {
    render(
      <Banner tone="attention" title="unknown" action={<button type="button">retry</button>} />,
    )
    const action = screen.getByRole("button", { name: "retry" }).parentElement
    expect(action?.classList).toContain("action")
    expect(action?.parentElement?.classList).toContain("content")
    expect(action?.previousElementSibling?.classList).toContain("body")
  })

  it("announces critical banners as alerts", () => {
    render(<Banner tone="critical" title="lost" />)
    expect(screen.getByRole("alert").dataset.state).toBe("open")
  })

  it("collapses and unmounts when closed", () => {
    const { rerender } = render(<Banner tone="info" title="stale" />)
    rerender(<Banner tone="info" title="stale" open={false} />)
    const banner = screen.getByRole("status")
    expect(banner.dataset.state).toBe("closed")
    fireEvent.transitionEnd(banner)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("offers a dismiss button", () => {
    const onDismiss = vi.fn()
    render(<Banner tone="attention" title="t" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole("button", { name: ru.action.close }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
