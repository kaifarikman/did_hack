import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  ACTION_KEYS,
  advance,
  buttonByText,
  capture,
  LOCALE_STORAGE_KEY,
  LOCALES,
  projectInfo,
  type RunContext,
  textOf,
} from "./driver"

const SHOW_ZOOM = 1.25
const RUN_MS = 9_000

async function expectOnScreen(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  if (box === null || viewport === null) return
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

for (const locale of LOCALES) {
  test(`show mode enlarges the panel · ${locale}`, async ({ page }, testInfo) => {
    const run: RunContext = { page, scenario: "show", locale, ...projectInfo(testInfo) }
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      LOCALE_STORAGE_KEY,
      locale,
    ] as const)
    await page.clock.install()
    await page.goto("/?view=show")
    await page.getByRole("combobox", { name: textOf(locale, "demo:picker") }).waitFor()
    const shell = page.locator("[data-view='show']")
    await expect(shell).toHaveCSS("zoom", String(SHOW_ZOOM))
    await capture(run, "idle")
    await expectOnScreen(page, buttonByText(page, locale, ACTION_KEYS.start))
    await buttonByText(page, locale, ACTION_KEYS.start).click()
    await advance(page, RUN_MS)
    await capture(run, "running")
    await expectOnScreen(page, buttonByText(page, locale, ACTION_KEYS.stop))
    await expectOnScreen(page, page.getByText(textOf(locale, "mission:status.running")).first())
    await expectOnScreen(page, page.getByText(textOf(locale, "mission:metric.battery")).first())
    const canvas = await page.evaluate(() => {
      const element = document.querySelector("canvas")
      return element === null
        ? null
        : {
            backing: element.width,
            layout: element.clientWidth,
            ratio: window.devicePixelRatio,
          }
    })
    expect(canvas).not.toBeNull()
    if (canvas !== null)
      expect(canvas.backing).toBeGreaterThanOrEqual(
        Math.floor(canvas.layout * canvas.ratio * SHOW_ZOOM) - 1,
      )
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
