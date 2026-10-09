import { MAP_MODES, SCENARIOS } from "@/domain/contract"
import type { MissionAllowance, MissionDraft } from "./contract"

export const ROBOT_COUNTS = ["1", "2"] as const

export function supportedChoices(allowed: MissionAllowance) {
  return {
    scenarios: SCENARIOS.filter((value) => allowed.scenarios.includes(value)),
    mapModes: MAP_MODES.filter((value) => allowed.mapModes.includes(value)),
    robots: ROBOT_COUNTS.filter((value) => allowed.robotCounts.includes(Number(value))),
  }
}

function selectedChoice<T extends string>(selected: T, choices: readonly T[]): T {
  return choices.includes(selected) ? selected : (choices[0] ?? selected)
}

export function supportedDraft(draft: MissionDraft, allowed: MissionAllowance): MissionDraft {
  const choices = supportedChoices(allowed)
  return {
    ...draft,
    scenario: selectedChoice(draft.scenario, choices.scenarios),
    mapMode: selectedChoice(draft.mapMode, choices.mapModes),
    robots: selectedChoice(draft.robots, choices.robots),
  }
}
