import { DEFAULT_BEHAVIOR, scriptOf } from "../baseline"
import { fillTemplate, journalFrom } from "../content"
import content from "../examples/scenarios/journalLong.json"
import type { FixtureScript, ScriptedJournalEntry } from "../script"
import { standardMission } from "../standardMission"

export const LONG_JOURNAL_SIZE = 420
const TEMPLATE_COUNT = content.templates.length

type Template = (typeof content.templates)[number]

function fillEntry(template: Template, values: Record<string, string | number>): object {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      key === "kind" ? value : fillTemplate(value, values),
    ]),
  )
}

function generated(lastFrame: number): ScriptedJournalEntry[] {
  const raw = Array.from({ length: LONG_JOURNAL_SIZE }, (_, index) => {
    const template = content.templates[index % TEMPLATE_COUNT] as Template
    const chain = Math.floor(index / TEMPLATE_COUNT) + 1
    const values = {
      n: index + 1,
      k: chain,
      cell: `C${(chain % 12) + 1}-${(chain % 8) + 1}`,
      energy: (1 + (chain % 7) * 0.25).toFixed(2),
    }
    const linked = index % TEMPLATE_COUNT < 4
    return {
      ...fillEntry(template, values),
      hypothesis_id: linked ? `long-hypothesis-${chain}` : null,
      experiment_id: linked && index % TEMPLATE_COUNT > 0 ? `long-experiment-${chain}` : null,
    }
  })
  return journalFrom(raw).map((entry, index) => {
    const atFrame = 1 + Math.floor((index * (lastFrame - 1)) / LONG_JOURNAL_SIZE)
    return { atFrame, entry: { ...entry, simulation_time_s: atFrame } }
  })
}

export function buildJournalLong(): FixtureScript {
  const mission = standardMission()
  return scriptOf(
    mission.frames,
    [...mission.journal, ...generated(mission.timeline.marks.finalIndex)],
    {
      behavior: { ...DEFAULT_BEHAVIOR, exportFailures: 1, slowExport: true },
    },
  )
}
