import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { ACTION_KEYS, ARTIFACTS_DIR, buttonByText, LOCALE_STORAGE_KEY, textOf } from "./driver"

const MEASURE_MS = 5_000
const WARMUP_MS = 1_500
const JANK_MS = 25
const MIN_FPS = 55

interface FrameStats {
  frames: number
  fps: number
  worstMs: number
  p95Ms: number
  janky: number
  mapCanvas: { width: number; height: number }
}

test("map keeps the frame rate on 1920×1080 during the success scenario", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "en"), LOCALE_STORAGE_KEY)
  await page.goto("/")
  await page.getByRole("combobox", { name: textOf("en", "demo:picker") }).click()
  await page
    .getByRole("option", { name: textOf("en", "demo:scenario.success"), exact: true })
    .click()
  await buttonByText(page, "en", ACTION_KEYS.start).click()
  await page.waitForTimeout(WARMUP_MS)
  const stats = await page.evaluate(
    ({ duration, jank }) =>
      new Promise<FrameStats>((resolve) => {
        const deltas: number[] = []
        let start = 0
        let previous = 0
        const step = (now: number): void => {
          if (start === 0) {
            start = now
            previous = now
          } else {
            deltas.push(now - previous)
            previous = now
          }
          if (now - start < duration) {
            requestAnimationFrame(step)
            return
          }
          const sorted = [...deltas].sort((first, second) => first - second)
          const canvas = document.querySelector("canvas")
          resolve({
            frames: deltas.length,
            fps: (deltas.length * 1000) / (now - start),
            worstMs: sorted[sorted.length - 1] ?? 0,
            p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            janky: deltas.filter((delta) => delta > jank).length,
            mapCanvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
          })
        }
        requestAnimationFrame(step)
      }),
    { duration: MEASURE_MS, jank: JANK_MS },
  )
  const target = path.join(ARTIFACTS_DIR, "fps.json")
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify({ measuredMs: MEASURE_MS, ...stats }, null, 2)}\n`)
  test.info().annotations.push({ type: "fps", description: stats.fps.toFixed(1) })
  expect(stats.frames).toBeGreaterThan(0)
  expect(stats.fps).toBeGreaterThanOrEqual(MIN_FPS)
})
