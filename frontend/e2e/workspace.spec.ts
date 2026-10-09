import { expect, type Locator, type Page, test } from "@playwright/test"
import { LOCALE_STORAGE_KEY, LOCALES, textOf } from "./driver"

const LAYOUT_TOLERANCE = 1
const TAB_CYCLES = 3

async function expectJournalBelow(research: Locator, journal: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const researchBox = await research.boundingBox()
      const journalBox = await journal.boundingBox()
      if (researchBox === null || journalBox === null) return false
      return (
        journalBox.y >= researchBox.y + researchBox.height - LAYOUT_TOLERANCE &&
        Math.abs(journalBox.x - researchBox.x) <= LAYOUT_TOLERANCE &&
        Math.abs(journalBox.width - researchBox.width) <= LAYOUT_TOLERANCE
      )
    })
    .toBe(true)
}

async function waitForResizeDelivery(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

for (const locale of LOCALES) {
  test(`workspace return preserves journal placement and drafts · ${locale}`, async ({
    page,
  }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      LOCALE_STORAGE_KEY,
      locale,
    ] as const)
    await page.goto("/")
    await page.getByRole("combobox", { name: textOf(locale, "demo:picker") }).waitFor()

    const research = page.getByRole("region", {
      name: textOf(locale, "research:title"),
      exact: true,
    })
    const journal = page.getByRole("region", {
      name: textOf(locale, "journal:title"),
      exact: true,
    })
    const seed = page.getByRole("textbox", { name: textOf(locale, "mission:form.seed") })
    const filter = page.getByRole("combobox", {
      name: textOf(locale, "journal:filter.label"),
    })
    const selectedKind = textOf(locale, "journal:kind.hypothesis")

    await expectJournalBelow(research, journal)
    await seed.fill("37")
    await filter.click()
    await page.getByRole("option", { name: selectedKind, exact: true }).click()
    await expect(filter).toContainText(selectedKind)

    for (let cycle = 0; cycle < TAB_CYCLES; cycle += 1) {
      await page.getByRole("radio", { name: textOf(locale, "analytics:tab") }).click()
      await expect(research).toBeHidden()
      await expect(journal).toBeHidden()
      await waitForResizeDelivery(page)

      await page.getByRole("radio", { name: textOf(locale, "analytics:controlTab") }).click()
      await waitForResizeDelivery(page)
      await expectJournalBelow(research, journal)
      await expect(seed).toHaveValue("37")
      await expect(filter).toContainText(selectedKind)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    }
  })

  test(`journal returns below research after widening and narrowing · ${locale}`, async ({
    page,
  }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      LOCALE_STORAGE_KEY,
      locale,
    ] as const)
    await page.goto("/")
    await page.getByRole("combobox", { name: textOf(locale, "demo:picker") }).waitFor()
    const research = page.getByRole("region", {
      name: textOf(locale, "research:title"),
      exact: true,
    })
    const journal = page.getByRole("region", {
      name: textOf(locale, "journal:title"),
      exact: true,
    })

    await expectJournalBelow(research, journal)
    await page.setViewportSize({ width: 2400, height: 900 })
    await expect
      .poll(async () => {
        const researchBox = await research.boundingBox()
        const journalBox = await journal.boundingBox()
        if (researchBox === null || journalBox === null) return false
        return journalBox.x >= researchBox.x + researchBox.width - LAYOUT_TOLERANCE
      })
      .toBe(true)

    await page.setViewportSize({ width: 1280, height: 800 })
    await waitForResizeDelivery(page)
    await expectJournalBelow(research, journal)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
