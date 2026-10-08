import { buildCommandUnknown } from "./scenarios/commandUnknown"
import { buildDisconnect } from "./scenarios/disconnect"
import { buildEnvStarting } from "./scenarios/envStarting"
import { buildFailed } from "./scenarios/failed"
import { buildHardEvents } from "./scenarios/hardEvents"
import { buildIdleReady } from "./scenarios/idleReady"
import { buildJournalLong } from "./scenarios/journalLong"
import { buildLlmFallback } from "./scenarios/llmFallback"
import { buildMediumAdaptation } from "./scenarios/mediumAdaptation"
import { buildPlanRevision } from "./scenarios/planRevision"
import { buildSlamBuilding } from "./scenarios/slamBuilding"
import { buildStartRejected } from "./scenarios/startRejected"
import { buildStopped } from "./scenarios/stopped"
import { buildSuccess } from "./scenarios/success"
import { buildTeamPartial } from "./scenarios/teamPartial"
import { buildTeamSuccess } from "./scenarios/teamSuccess"
import type { FixtureScript } from "./script"

export const FIXTURE_SCENARIOS = [
  "env_starting",
  "idle_ready",
  "success",
  "llm_fallback",
  "plan_revision",
  "medium_adaptation",
  "hard_events",
  "slam_building",
  "team_success",
  "team_partial",
  "disconnect",
  "failed",
  "start_rejected",
  "command_unknown",
  "stopped",
  "journal_long",
] as const

export type FixtureScenarioName = (typeof FIXTURE_SCENARIOS)[number]

export const DEFAULT_FIXTURE_SCENARIO: FixtureScenarioName = "success"

const BUILDERS: Record<FixtureScenarioName, () => FixtureScript> = {
  env_starting: buildEnvStarting,
  idle_ready: buildIdleReady,
  success: buildSuccess,
  llm_fallback: buildLlmFallback,
  plan_revision: buildPlanRevision,
  medium_adaptation: buildMediumAdaptation,
  hard_events: buildHardEvents,
  slam_building: buildSlamBuilding,
  team_success: buildTeamSuccess,
  team_partial: buildTeamPartial,
  disconnect: buildDisconnect,
  failed: buildFailed,
  start_rejected: buildStartRejected,
  command_unknown: buildCommandUnknown,
  stopped: buildStopped,
  journal_long: buildJournalLong,
}

const cache = new Map<FixtureScenarioName, FixtureScript>()

export function buildScript(name: FixtureScenarioName): FixtureScript {
  const known = cache.get(name)
  if (known !== undefined) return known
  const script = BUILDERS[name]()
  cache.set(name, script)
  return script
}
