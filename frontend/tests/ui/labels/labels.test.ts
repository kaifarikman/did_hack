import { describe, expect, it } from "vitest"
import { FIXTURE_SCENARIOS } from "../../../src/adapters/fixture/catalog"
import { DEMO_SCENARIO_LABELS } from "../../../src/ui/app/demoLabels"
import { DEMO_BADGE_LABEL, DEMO_PICKER_LABEL } from "../../../src/ui/features/demo/labels"
import * as journal from "../../../src/ui/features/journal/labels"
import { LEGEND } from "../../../src/ui/features/map/labels"
import * as mission from "../../../src/ui/features/mission/labels"
import * as research from "../../../src/ui/features/research/labels"
import * as team from "../../../src/ui/features/team/labels"
import { baseKeys, F2_NAMESPACES, hasKey, readDictionary } from "./dictionaries"

const LABEL_MAPS: Record<string, Readonly<Record<string, string>>> = {
  "mission.STATUS_LABELS": mission.STATUS_LABELS,
  "mission.GOAL_LABELS": mission.GOAL_LABELS,
  "mission.JUDGE_LABELS": mission.JUDGE_LABELS,
  "mission.PLANNER_LABELS": mission.PLANNER_LABELS,
  "mission.OUTCOME_LABELS": mission.OUTCOME_LABELS,
  "mission.SCENARIO_LABELS": mission.SCENARIO_LABELS,
  "mission.MAP_MODE_LABELS": mission.MAP_MODE_LABELS,
  "mission.METRIC_LABELS": mission.METRIC_LABELS,
  "research.PLAN_SOURCE_LABELS": research.PLAN_SOURCE_LABELS,
  "research.STEP_GOAL_LABELS": research.STEP_GOAL_LABELS,
  "research.SENSOR_STATE_LABELS": research.SENSOR_STATE_LABELS,
  "research.SENSOR_FAULT_LABELS": research.SENSOR_FAULT_LABELS,
  "research.HYPOTHESIS_STATUS_LABELS": research.HYPOTHESIS_STATUS_LABELS,
  "research.HYPOTHESIS_KIND_LABELS": research.HYPOTHESIS_KIND_LABELS,
  "journal.KIND_LABELS": journal.KIND_LABELS,
  "journal.EXPORT_PHASE_LABELS": journal.EXPORT_PHASE_LABELS,
  "journal.CHAIN_LABELS": journal.CHAIN_LABELS,
  "team.TEAM_OUTCOME_LABELS": team.TEAM_OUTCOME_LABELS,
  "map.LEGEND": Object.fromEntries(LEGEND.map((item) => [item.role, item.label])),
}

const isCyrillic = (char: string): boolean =>
  (char.codePointAt(0) ?? 0) >= 0x400 && (char.codePointAt(0) ?? 0) <= 0x4ff

const SINGLE_KEYS = [
  mission.NO_GOAL_LABEL,
  journal.FILTER_ALL_LABEL,
  DEMO_BADGE_LABEL,
  DEMO_PICKER_LABEL,
  ...FIXTURE_SCENARIOS.map((name) => DEMO_SCENARIO_LABELS[name]),
]

describe("F2 dictionaries", () => {
  it.each(F2_NAMESPACES)("%s has the same keys in ru and en", (namespace) => {
    expect(baseKeys(readDictionary("ru", namespace))).toEqual(
      baseKeys(readDictionary("en", namespace)),
    )
  })

  it.each(Object.entries(LABEL_MAPS))("%s points at existing keys", (_name, labels) => {
    for (const key of Object.values(labels)) {
      expect(hasKey("ru", key), key).toBe(true)
      expect(hasKey("en", key), key).toBe(true)
    }
  })

  it("has every single key, demo scenario label and plural form", () => {
    for (const key of SINGLE_KEYS) {
      expect(hasKey("ru", key), key).toBe(true)
      expect(hasKey("en", key), key).toBe(true)
    }
    const ru = readDictionary("ru", "research").label as Record<string, unknown>
    const en = readDictionary("en", "research").label as Record<string, unknown>
    const forms = (labels: Record<string, unknown>) =>
      Object.keys(labels)
        .filter((key) => key.startsWith("hazardItem_"))
        .sort()
    expect(forms(ru)).toEqual([
      "hazardItem_few",
      "hazardItem_many",
      "hazardItem_one",
      "hazardItem_other",
    ])
    expect(forms(en)).toEqual(["hazardItem_one", "hazardItem_other"])
  })

  it("keeps Cyrillic out of English dictionaries", () => {
    for (const namespace of F2_NAMESPACES) {
      expect([...JSON.stringify(readDictionary("en", namespace))].some(isCyrillic)).toBe(false)
    }
  })
})
