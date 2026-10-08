import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  ARTIFACTS_DIR,
  capture,
  LOCALE_STORAGE_KEY,
  projectInfo,
  type RunContext,
} from "./driver"

const NATIVE_CONTROLS =
  "select, input[type='number'], input[type='checkbox'], input[type='radio'], details"
const POPUP_TRIGGERS =
  "[aria-haspopup='listbox'], [aria-haspopup='menu'], [aria-haspopup='dialog']"
const POPUPS =
  "[data-layer-host] > [data-state], [data-state]:has(> [role='menu']), [role='dialog'][data-state]"
const OPEN_POPUPS =
  "[data-layer-host] > [data-state='open'], [data-state='open']:has(> [role='menu']), [role='dialog'][data-state='open']"
const UNMOUNT_WAIT_MS = 1000
const OPEN_WAIT_MS = 400

async function nativeControls(page: Page): Promise<string[]> {
  return page.locator(NATIVE_CONTROLS).evaluateAll((elements) =>
    elements
      .filter((element) => element.closest("fieldset") === null)
      .map((element) => {
        const label =
          element.getAttribute("aria-label") ?? element.closest("label")?.textContent ?? ""
        return `${element.tagName.toLowerCase()}${element.getAttribute("type") ? `[${element.getAttribute("type")}]` : ""}: ${label.trim().slice(0, 40)}`
      }),
  )
}

async function isAnimated(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const transitions = style.transitionDuration
      .split(",")
      .map((item) => Number.parseFloat(item))
    return style.animationName !== "none" || transitions.some((seconds) => seconds > 0)
  })
}

test("custom controls open and close with animation", async ({ page }, testInfo) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "en"), LOCALE_STORAGE_KEY)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const info = projectInfo(testInfo)
  const run: RunContext = { page, scenario: "controls", locale: "en", ...info }
  const native = await nativeControls(page)
  const report = path.join(
    ARTIFACTS_DIR,
    "controls",
    `native-${info.width}-${info.motion}.json`,
  )
  mkdirSync(path.dirname(report), { recursive: true })
  writeFileSync(report, `${JSON.stringify({ native }, null, 2)}\n`)
  testInfo.annotations.push({ type: "native-controls", description: String(native.length) })

  expect(native).toEqual([])
  const triggers = page.locator(POPUP_TRIGGERS)
  const count = await triggers.count()
  expect(count).toBeGreaterThan(0)

  for (let index = 0; index < count; index += 1) {
    const trigger = triggers.nth(index)
    if (!(await trigger.isVisible()) || (await trigger.isDisabled())) continue
    await trigger.click()
    const popup = page.locator(POPUPS).last()
    await expect(popup).toHaveAttribute("data-state", "open")
    expect(await isAnimated(popup)).toBe(true)
    await page.waitForTimeout(OPEN_WAIT_MS)
    await capture(run, `open-${index}`)
    await page.keyboard.press("Escape")
    const closing = await popup.getAttribute("data-state", { timeout: 200 }).catch(() => null)
    expect([null, "closed"]).toContain(closing)
    await expect(page.locator(OPEN_POPUPS)).toHaveCount(0)
    await page.waitForTimeout(UNMOUNT_WAIT_MS)
    await expect(page.locator(POPUPS)).toHaveCount(0)
  }
})
