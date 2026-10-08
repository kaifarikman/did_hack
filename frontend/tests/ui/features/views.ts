import { READY_HEALTH } from "@/adapters/fixture/baseline"
import { buildScript, type FixtureScenarioName } from "@/adapters/fixture/catalog"
import type { MissionController } from "@/application/missionController"
import { INITIAL_VIEW, type MissionViewState } from "@/application/viewState"
import type { MissionSnapshot } from "@/domain/contract"
import ruCommon from "@/ui/shared/i18n/locales/ru/common.json"
import ruJournal from "@/ui/shared/i18n/locales/ru/journal.json"
import ruMap from "@/ui/shared/i18n/locales/ru/map.json"
import ruMission from "@/ui/shared/i18n/locales/ru/mission.json"
import ruResearch from "@/ui/shared/i18n/locales/ru/research.json"
import ruTeam from "@/ui/shared/i18n/locales/ru/team.json"

export const RU = {
  common: ruCommon,
  journal: ruJournal,
  map: ruMap,
  mission: ruMission,
  research: ruResearch,
  team: ruTeam,
}

type Tree = { readonly [key: string]: string | Tree }

export function ruText(key: string): string {
  const [namespace = "", path = ""] = key.split(":")
  let node: string | Tree | undefined = (RU as unknown as Record<string, Tree>)[namespace]
  for (const part of path.split(".")) node = typeof node === "string" ? undefined : node?.[part]
  if (typeof node !== "string") throw new Error(`missing text ${key}`)
  return node
}

export function frame(name: FixtureScenarioName, index: number): MissionSnapshot {
  const frames = buildScript(name).frames
  const found = index < 0 ? frames[frames.length + index] : frames[index]
  if (found === undefined) throw new Error(`no frame ${index} in ${name}`)
  return { ...found, run_id: "run-1" }
}

export function findFrame(
  name: FixtureScenarioName,
  match: (snapshot: MissionSnapshot) => boolean,
): MissionSnapshot {
  const found = buildScript(name).frames.find(match)
  if (found === undefined) throw new Error(`no matching frame in ${name}`)
  return { ...found, run_id: "run-1" }
}

export function viewOf(patch: Partial<MissionViewState> = {}): MissionViewState {
  return { ...INITIAL_VIEW, health: READY_HEALTH, connection: "live", ...patch }
}

export interface ControllerSpy {
  readonly controller: MissionController
  readonly calls: string[]
}

export function controllerSpy(): ControllerSpy {
  const calls: string[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map(String).join(",")})`)
      return Promise.resolve(null)
    }
  const controller = {
    startRun: record("startRun"),
    stopRun: record("stopRun"),
    retryCommand: record("retryCommand"),
    dismissCommandMessage: record("dismissCommandMessage"),
    selectHypothesis: record("selectHypothesis"),
    exportJournal: record("exportJournal"),
  } as unknown as MissionController
  return { controller, calls }
}
