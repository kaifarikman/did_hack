import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  compareWithBaseline,
  countByFile,
  formatBaseline,
  parseBaseline,
  prunedBaseline,
} from "./baseline.ts"
import { collectFiles, frontendRoot, MissingSourcesError } from "./files.ts"
import { CHECKS } from "./registry.ts"
import type { Check, SourceFile, Violation } from "./types.ts"

const root = frontendRoot(import.meta.dirname)
const baselineDir = join(root, "scripts", "baselines")
const prune = process.argv.includes("--prune")
const recordMissing = process.argv.includes("--record-missing")

const write = (line: string) => process.stdout.write(`${line}\n`)

function baselinePath(check: Check): string {
  return join(baselineDir, `${check.id}.txt`)
}

function runCheck(check: Check, files: readonly SourceFile[]): boolean {
  const violations: readonly Violation[] = check.run(files)
  const current = countByFile(violations)
  const path = baselinePath(check)
  if (!existsSync(path) && recordMissing) writeFileSync(path, formatBaseline(current))
  const baseline = existsSync(path) ? parseBaseline(readFileSync(path, "utf8")) : new Map()
  const { regressions, improvements } = compareWithBaseline(current, baseline)
  for (const regression of regressions) {
    write(
      `  ${check.id}: ${regression.file} has ${regression.current}, allowed ${regression.allowed}`,
    )
    for (const violation of violations.filter((item) => item.file === regression.file)) {
      write(`    ${violation.message}`)
    }
  }
  if (improvements.length > 0 && prune)
    writeFileSync(path, formatBaseline(prunedBaseline(current, baseline)))
  if (improvements.length > 0 && !prune) {
    write(
      `  ${check.id}: ${improvements.length} baseline entries improved, run npm run rules -- --prune`,
    )
  }
  const total = [...current.values()].reduce((sum, count) => sum + count, 0)
  write(`${regressions.length === 0 ? "ok  " : "FAIL"} ${check.id} (${total} known violations)`)
  return regressions.length === 0
}

function runAll(files: readonly SourceFile[]): number {
  const results = CHECKS.map((check) => runCheck(check, files))
  const failed = results.filter((passed) => !passed).length
  write(
    failed === 0 ? `rules: ${CHECKS.length} checks passed` : `rules: ${failed} checks failed`,
  )
  return failed === 0 ? 0 : 1
}

try {
  process.exitCode = runAll(collectFiles(root))
} catch (error) {
  if (!(error instanceof MissingSourcesError)) throw error
  write(error.message)
  process.exitCode = 2
}
