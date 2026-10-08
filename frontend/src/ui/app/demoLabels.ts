import type { FixtureScenarioName } from "@/adapters/fixture/catalog"
import type { DemoKey } from "@/ui/features/demo/labels"

export const DEMO_SCENARIO_LABELS: Readonly<Record<FixtureScenarioName, DemoKey>> = {
  env_starting: "demo:scenario.env_starting",
  idle_ready: "demo:scenario.idle_ready",
  success: "demo:scenario.success",
  llm_fallback: "demo:scenario.llm_fallback",
  plan_revision: "demo:scenario.plan_revision",
  medium_adaptation: "demo:scenario.medium_adaptation",
  hard_events: "demo:scenario.hard_events",
  slam_building: "demo:scenario.slam_building",
  team_success: "demo:scenario.team_success",
  team_partial: "demo:scenario.team_partial",
  disconnect: "demo:scenario.disconnect",
  failed: "demo:scenario.failed",
  start_rejected: "demo:scenario.start_rejected",
  command_unknown: "demo:scenario.command_unknown",
  stopped: "demo:scenario.stopped",
  journal_long: "demo:scenario.journal_long",
}
