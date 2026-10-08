import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ARTIFACTS_DIR, type AxeRecord } from "./driver"

interface RuleSummary {
  id: string
  impact: string | null
  help: string
  pages: number
  nodes: number
  scenarios: string[]
}

// biome-ignore lint/style/noDefaultExport: Playwright globalTeardown loads the default export
export default function summarizeAxe(): void {
  const directory = path.join(ARTIFACTS_DIR, "axe")
  if (!existsSync(directory)) return
  const records = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(directory, name), "utf8")) as AxeRecord)
  const rules = new Map<string, RuleSummary>()
  for (const record of records) {
    for (const violation of record.violations) {
      const rule = rules.get(violation.id) ?? {
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        pages: 0,
        nodes: 0,
        scenarios: [],
      }
      rule.pages += 1
      rule.nodes += violation.nodes
      if (!rule.scenarios.includes(record.scenario)) rule.scenarios.push(record.scenario)
      rules.set(violation.id, rule)
    }
  }
  const summary = {
    audits: records.length,
    clean: records.filter((record) => record.violations.length === 0).length,
    rules: [...rules.values()].sort((first, second) => second.nodes - first.nodes),
  }
  writeFileSync(
    path.join(ARTIFACTS_DIR, "axe-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
}
