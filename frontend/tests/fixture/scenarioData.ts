import {
  buildScript,
  FIXTURE_SCENARIOS,
  type FixtureScenarioName,
} from "../../src/adapters/fixture/catalog"
import type { FixtureScript } from "../../src/adapters/fixture/script"
import type {
  HealthStatus,
  JournalEntry,
  MapData,
  MissionSnapshot,
  TeamRobotView,
} from "../../src/domain/contract"

export interface ScenarioData {
  name: FixtureScenarioName
  script: FixtureScript
}

export const ALL_SCRIPTS: ScenarioData[] = FIXTURE_SCENARIOS.map((name) => ({
  name,
  script: buildScript(name),
}))

export function allSnapshots(): MissionSnapshot[] {
  return ALL_SCRIPTS.flatMap(({ script }) => [script.idle, ...script.frames])
}

export function allRobots(): TeamRobotView[] {
  return allSnapshots().flatMap((snapshot) => snapshot.team?.robots ?? [])
}

export function allHealth(): HealthStatus[] {
  return ALL_SCRIPTS.flatMap(({ script }) => script.health)
}

export function allMaps(): MapData[] {
  return ALL_SCRIPTS.flatMap(({ script }) =>
    script.maps.flatMap((revision) => (revision.map === null ? [] : [revision.map])),
  )
}

export function allEntries(): Array<Omit<JournalEntry, "sequence">> {
  return ALL_SCRIPTS.flatMap(({ script }) => script.journal.map((item) => item.entry))
}

export function scriptFor(name: FixtureScenarioName): FixtureScript {
  return buildScript(name)
}
