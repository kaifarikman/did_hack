import type { Locale } from "./locale"
import enAnalytics from "./locales/en/analytics.json"
import enCommon from "./locales/en/common.json"
import enDemo from "./locales/en/demo.json"
import enErrors from "./locales/en/errors.json"
import enJournal from "./locales/en/journal.json"
import enMap from "./locales/en/map.json"
import enMission from "./locales/en/mission.json"
import enResearch from "./locales/en/research.json"
import enTeam from "./locales/en/team.json"
import ruAnalytics from "./locales/ru/analytics.json"
import ruCommon from "./locales/ru/common.json"
import ruDemo from "./locales/ru/demo.json"
import ruErrors from "./locales/ru/errors.json"
import ruJournal from "./locales/ru/journal.json"
import ruMap from "./locales/ru/map.json"
import ruMission from "./locales/ru/mission.json"
import ruResearch from "./locales/ru/research.json"
import ruTeam from "./locales/ru/team.json"

export const NAMESPACES = [
  "analytics",
  "common",
  "errors",
  "mission",
  "map",
  "research",
  "journal",
  "team",
  "demo",
] as const

export type Namespace = (typeof NAMESPACES)[number]

export const DEFAULT_NAMESPACE: Namespace = "common"

const en = {
  analytics: enAnalytics,
  common: enCommon,
  errors: enErrors,
  mission: enMission,
  map: enMap,
  research: enResearch,
  journal: enJournal,
  team: enTeam,
  demo: enDemo,
}

const ru = {
  analytics: ruAnalytics,
  common: ruCommon,
  errors: ruErrors,
  mission: ruMission,
  map: ruMap,
  research: ruResearch,
  journal: ruJournal,
  team: ruTeam,
  demo: ruDemo,
}

export type Dictionary = typeof en

export const resources = { en, ru } satisfies Record<Locale, Record<Namespace, object>>
