import { expect, test } from "@playwright/test"
import {
  ACTION_KEYS,
  advance,
  audit,
  buttonByText,
  capture,
  chooseScenario,
  LOCALES,
  openApp,
  projectInfo,
  type RunContext,
  settle,
  textOf,
} from "./driver"
import { PLANS, SCENARIO_ORDER, type Step } from "./plans"

const REDUCED_DURATION = "1ms"

async function perform(run: RunContext, step: Step, lastFrame: string): Promise<string> {
  const { page } = run
  switch (step.kind) {
    case "shot":
      await capture(run, step.frame)
      return step.frame
    case "advance":
      await advance(page, step.ms)
      return lastFrame
    case "navigation":
      await page
        .getByRole("radio", {
          name: textOf(run.locale, "mission:navigation.navigation"),
          exact: true,
        })
        .check()
      await page
        .getByLabel(textOf(run.locale, "mission:navigation.x"), { exact: true })
        .fill("-0.5")
      await page
        .getByLabel(textOf(run.locale, "mission:navigation.y"), { exact: true })
        .fill("0.25")
      return lastFrame
    case "start":
      await buttonByText(page, run.locale, ACTION_KEYS.start).click()
      await settle(page)
      return lastFrame
    case "stop":
      await buttonByText(page, run.locale, ACTION_KEYS.stop).click()
      await settle(page)
      return lastFrame
    case "retry":
      await buttonByText(page, run.locale, ACTION_KEYS.retry).click()
      await settle(page)
      return lastFrame
    case "export":
      await buttonByText(page, run.locale, ACTION_KEYS.export).click()
      await settle(page)
      return lastFrame
    case "see":
      await expect(
        page.getByText(textOf(run.locale, step.key), { exact: true }).first(),
      ).toBeVisible()
      return lastFrame
    case "axe": {
      const record = await audit(run, lastFrame)
      expect(record.violations, `axe on ${run.scenario} ${lastFrame}`).toEqual([])
      return lastFrame
    }
  }
}

for (const scenario of SCENARIO_ORDER) {
  for (const locale of LOCALES) {
    test(`${scenario} · ${locale}`, async ({ page }, testInfo) => {
      const run: RunContext = { page, scenario, locale, ...projectInfo(testInfo) }
      await openApp(page, locale)
      await chooseScenario(page, locale, scenario)
      if (run.motion === "reduce") {
        const base = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--dur-base").trim(),
        )
        expect(base, "reduced motion shortens durations").toBe(REDUCED_DURATION)
      }
      let lastFrame = "idle"
      for (const step of PLANS[scenario]) lastFrame = await perform(run, step, lastFrame)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0)
    })
  }
}
