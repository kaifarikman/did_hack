import { expect, type Page, test } from "@playwright/test"
import {
  capture,
  LOCALE_STORAGE_KEY,
  type Locale,
  projectInfo,
  type RunContext,
  textOf,
} from "./driver"

const SETTLE_MS = 600

function triggerName(locale: Locale): string {
  return textOf(locale, "common:language.current").replace(
    "{{name}}",
    textOf(locale, `common:language.${locale}`),
  )
}

async function openWith(page: Page, locale: Locale): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    LOCALE_STORAGE_KEY,
    locale,
  ] as const)
  await page.goto("/")
}

test("language menu switches html[lang] and returns focus", async ({ page }, testInfo) => {
  await openWith(page, "ru")
  const trigger = page.getByRole("button", { name: triggerName("ru"), exact: true })
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu")
  await trigger.click()
  const layer = page.locator("[data-state='open']:has(> [role='menu'])")
  await expect(layer).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  const menu = page.getByRole("menu", { name: textOf("ru", "common:language.legend") })
  await expect(menu.getByRole("menuitemradio")).toHaveCount(2)
  await expect(
    menu.getByRole("menuitemradio", { name: textOf("ru", "common:language.ru") }),
  ).toHaveAttribute("aria-checked", "true")
  const run: RunContext = { page, scenario: "locale", locale: "ru", ...projectInfo(testInfo) }
  await page.waitForTimeout(SETTLE_MS)
  await capture(run, "menu-open")
  await menu.getByRole("menuitemradio", { name: textOf("ru", "common:language.en") }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  const englishTrigger = page.getByRole("button", { name: triggerName("en"), exact: true })
  await expect(englishTrigger).toBeFocused({ timeout: SETTLE_MS * 3 })
  await expect(menu).toHaveCount(0)
  await expect(englishTrigger).toHaveAttribute("aria-expanded", "false")
})

test("language menu works from the keyboard", async ({ page }) => {
  await openWith(page, "en")
  const trigger = page.getByRole("button", { name: triggerName("en"), exact: true })
  await trigger.focus()
  await page.keyboard.press("Enter")
  const english = page.getByRole("menuitemradio", { name: textOf("en", "common:language.en") })
  await expect(english).toBeFocused()
  await page.keyboard.press("Home")
  await expect(
    page.getByRole("menuitemradio", { name: textOf("en", "common:language.ru") }),
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
})
