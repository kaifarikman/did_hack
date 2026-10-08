import type { Violation } from "./types.ts"

export type FileCounts = ReadonlyMap<string, number>

export interface Regression {
  readonly file: string
  readonly current: number
  readonly allowed: number
}

export interface Comparison {
  readonly regressions: readonly Regression[]
  readonly improvements: readonly Regression[]
}

export function countByFile(violations: readonly Violation[]): FileCounts {
  const counts = new Map<string, number>()
  for (const violation of violations) {
    counts.set(violation.file, (counts.get(violation.file) ?? 0) + (violation.weight ?? 1))
  }
  return counts
}

export function parseBaseline(text: string): FileCounts {
  const counts = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const [count, file] = line.split("\t")
    if (count === undefined || file === undefined || file === "") continue
    counts.set(file, Number(count))
  }
  return counts
}

export function formatBaseline(counts: FileCounts): string {
  const lines = [...counts]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, count]) => `${count}\t${file}`)
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}

export function compareWithBaseline(current: FileCounts, baseline: FileCounts): Comparison {
  const regressions: Regression[] = []
  const improvements: Regression[] = []
  for (const [file, count] of current) {
    const allowed = baseline.get(file) ?? 0
    if (count > allowed) regressions.push({ file, current: count, allowed })
  }
  for (const [file, allowed] of baseline) {
    const count = current.get(file) ?? 0
    if (count < allowed) improvements.push({ file, current: count, allowed })
  }
  return { regressions, improvements }
}

export function prunedBaseline(current: FileCounts, baseline: FileCounts): FileCounts {
  const pruned = new Map<string, number>()
  for (const [file, allowed] of baseline) {
    const count = Math.min(current.get(file) ?? 0, allowed)
    if (count > 0) pruned.set(file, count)
  }
  return pruned
}
