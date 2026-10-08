import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { LocaleSwitch } from "@/ui/features/locale-switch"
import enCommon from "@/ui/shared/i18n/locales/en/common.json"
import ruCommon from "@/ui/shared/i18n/locales/ru/common.json"
import { applyMotionTokens, setReducedMotion } from "../../setup/motionEnvironment"
import { renderWithLocale } from "./render"

const RU_TRIGGER = ruCommon.language.current.replace("{{name}}", ruCommon.language.ru)
const EN_TRIGGER = enCommon.language.current.replace("{{name}}", enCommon.language.en)

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: RU_TRIGGER }))
  return screen.getByRole("menu", { name: ruCommon.language.legend })
}

describe("locale switch", () => {
  beforeEach(() => {
    applyMotionTokens()
    setReducedMotion(true)
  })

  it("is an icon button that announces the current language and a menu popup", () => {
    renderWithLocale(<LocaleSwitch />)
    const trigger = screen.getByRole("button", { name: RU_TRIGGER })
    expect(trigger.getAttribute("title")).toBe(RU_TRIGGER)
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("lists every locale with a flag and its own name, checking the current one", () => {
    renderWithLocale(<LocaleSwitch />)
    const menu = openMenu()
    expect(screen.getByRole("button", { name: RU_TRIGGER }).getAttribute("aria-expanded")).toBe(
      "true",
    )
    const items = within(menu).getAllByRole("menuitemradio")
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"])
    expect(items.map((item) => item.querySelector("img")?.getAttribute("src"))).toEqual([
      expect.stringContaining("ru"),
      expect.stringContaining("gb"),
    ])
    expect(within(menu).getByText(ruCommon.language.en).getAttribute("lang")).toBe("en")
    expect(within(menu).getByText(ruCommon.language.ru).getAttribute("lang")).toBe("ru")
  })

  it("switches the language at once, then closes and returns focus to the trigger", async () => {
    renderWithLocale(<LocaleSwitch />)
    const menu = openMenu()
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: ruCommon.language.en }))
    })
    expect(document.documentElement.lang).toBe("en")
    const trigger = screen.getByRole("button", { name: EN_TRIGGER })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })

  it("closes at once without the settle delay when chosen from the keyboard", async () => {
    setReducedMotion(false)
    renderWithLocale(<LocaleSwitch />)
    const trigger = screen.getByRole("button", { name: RU_TRIGGER })
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(trigger)
    const menu = screen.getByRole("menu", { name: ruCommon.language.legend })
    expect(menu.closest("[data-instant]")?.getAttribute("data-instant")).toBe("true")
    const english = within(menu).getByRole("menuitemradio", { name: ruCommon.language.en })
    fireEvent.keyDown(english, { key: "Enter" })
    await act(async () => {
      fireEvent.click(english)
    })
    expect(screen.getByRole("button", { name: EN_TRIGGER }).getAttribute("aria-expanded")).toBe(
      "false",
    )
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("closes on Escape and gives focus back", async () => {
    renderWithLocale(<LocaleSwitch />)
    openMenu()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole("button", { name: RU_TRIGGER }))
  })
})
