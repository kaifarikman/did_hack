import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import AxeBuilder from "@axe-core/playwright"
import type { Locator, Page, TestInfo } from "@playwright/test"

export type Locale = "ru" | "en"

export const LOCALES: readonly Locale[] = ["ru", "en"]
export const LOCALE_STORAGE_KEY = "did-locale"
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ARTIFACTS_DIR =
  process.env.FRONTEND_ARTIFACTS ?? path.resolve(HERE, "../../../../../artifacts/frontend")

type Tree = { readonly [key: string]: string | Tree }

const dictionaries = new Map<string, Tree>()

function dictionary(locale: Locale, namespace: string): Tree {
  const id = `${locale}/${namespace}`
  const known = dictionaries.get(id)
  if (known !== undefined) return known
  const file = path.resolve(HERE, `../src/ui/shared/i18n/locales/${id}.json`)
  const loaded = JSON.parse(readFileSync(file, "utf8")) as Tree
  dictionaries.set(id, loaded)
  return loaded
}

export function textOf(locale: Locale, key: string): string {
  const [namespace = "", keyPath = ""] = key.split(":")
  let node: string | Tree | undefined = dictionary(locale, namespace)
  for (const part of keyPath.split("."))
    node = typeof node === "string" ? undefined : node?.[part]
  if (typeof node !== "string") throw new Error(`missing text ${key}`)
  return node
}

export function buttonByText(page: Page, locale: Locale, key: string): Locator {
  return page.getByRole("button", { name: textOf(locale, key), exact: true })
}

const TICK_MS = 250
const SETTLE_MS = 60
const ANIMATION_WAIT_MS = 3000
const OPTION_CLOSE_MS = 500
export const ACTION_KEYS = {
  start: "mission:action.start",
  stop: "mission:action.stop",
  retry: "mission:action.retry",
  export: "journal:export.action",
} as const

export interface RunContext {
  readonly page: Page
  readonly scenario: string
  readonly locale: Locale
  readonly width: number
  readonly motion: string
}

export function projectInfo(testInfo: TestInfo): { width: number; motion: string } {
  const metadata = testInfo.project.metadata as { width?: number; motion?: string }
  return { width: metadata.width ?? 0, motion: metadata.motion ?? "normal" }
}

export async function openApp(page: Page, locale: Locale): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        return
      }
    },
    [LOCALE_STORAGE_KEY, locale] as const,
  )
  await page.clock.install()
  await page.goto("/")
  await page.getByRole("combobox", { name: textOf(locale, "demo:picker") }).waitFor()
}

export async function chooseScenario(
  page: Page,
  locale: Locale,
  scenario: string,
): Promise<void> {
  await page.getByRole("combobox", { name: textOf(locale, "demo:picker") }).click()
  await settle(page)
  await page
    .getByRole("option", { name: textOf(locale, `demo:scenario.${scenario}`), exact: true })
    .click()
  await advance(page, OPTION_CLOSE_MS)
}

export async function advance(page: Page, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    await page.clock.runFor(Math.min(TICK_MS, ms - elapsed))
  }
  await settle(page)
}

export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS)
}

async function finiteAnimationsRunning(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .some(
        (animation) =>
          animation.timeline === document.timeline &&
          animation.playState === "running" &&
          animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
      ),
  )
}

async function settleAnimations(page: Page): Promise<void> {
  for (let waited = 0; waited < ANIMATION_WAIT_MS; waited += SETTLE_MS) {
    if (!(await finiteAnimationsRunning(page))) return
    await page.waitForTimeout(SETTLE_MS)
  }
}

export function shotPath(run: RunContext, frame: string): string {
  return path.join(
    ARTIFACTS_DIR,
    run.scenario,
    `${run.locale}-${run.width}-${run.motion}-${frame}.png`,
  )
}

export async function capture(run: RunContext, frame: string): Promise<void> {
  const target = shotPath(run, frame)
  mkdirSync(path.dirname(target), { recursive: true })
  await run.page.screenshot({ path: target, animations: "disabled" })
}

export interface AxeRecord {
  scenario: string
  locale: Locale
  width: number
  motion: string
  frame: string
  violations: Array<{
    id: string
    impact: string | null
    nodes: number
    help: string
    targets: string[]
  }>
}

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>

async function analyzeAtRest(page: Page): Promise<AxeResults> {
  await settleAnimations(page)
  const first = await new AxeBuilder({ page }).analyze()
  if (first.violations.length === 0) return first
  await settleAnimations(page)
  return new AxeBuilder({ page }).analyze()
}

export async function audit(run: RunContext, frame: string): Promise<AxeRecord> {
  const result = await analyzeAtRest(run.page)
  const record: AxeRecord = {
    scenario: run.scenario,
    locale: run.locale,
    width: run.width,
    motion: run.motion,
    frame,
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      nodes: violation.nodes.length,
      help: violation.help,
      targets: violation.nodes.map(
        (node) => `${node.target.join(" ")} :: ${node.failureSummary ?? ""}`,
      ),
    })),
  }
  const target = path.join(
    ARTIFACTS_DIR,
    "axe",
    `${run.scenario}-${run.locale}-${run.width}-${frame}.json`,
  )
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`)
  return record
}
