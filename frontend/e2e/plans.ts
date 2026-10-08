import type { FixtureScenarioName } from "../src/adapters/fixture/catalog"

export type Step =
  | { readonly kind: "navigation" }
  | { readonly kind: "shot"; readonly frame: string }
  | { readonly kind: "advance"; readonly ms: number }
  | { readonly kind: "start" }
  | { readonly kind: "stop" }
  | { readonly kind: "retry" }
  | { readonly kind: "export" }
  | { readonly kind: "axe" }
  | { readonly kind: "see"; readonly key: string }

const shot = (frame: string): Step => ({ kind: "shot", frame })
const advance = (ms: number): Step => ({ kind: "advance", ms })
const START: Step = { kind: "start" }
const STOP: Step = { kind: "stop" }
const RETRY: Step = { kind: "retry" }
const EXPORT: Step = { kind: "export" }
const AXE: Step = { kind: "axe" }
const see = (key: string): Step => ({ kind: "see", key })

const runToEnd = (...finals: string[]): readonly Step[] => [
  advance(3_000),
  shot("early"),
  advance(9_000),
  shot("mid"),
  advance(10_000),
  shot("late"),
  advance(12_000),
  shot("end"),
  ...finals.map(see),
  AXE,
]

const RUN_TO_END = runToEnd("mission:status.completed", "mission:outcome.success")
const STANDARD: readonly Step[] = [shot("idle"), START, ...RUN_TO_END]

export const PLANS: Readonly<Record<FixtureScenarioName, readonly Step[]>> = {
  nav_success: [
    { kind: "navigation" },
    START,
    ...runToEnd("mission:navigation.outcome.success"),
  ],
  nav_not_reached: [
    { kind: "navigation" },
    START,
    ...runToEnd("mission:navigation.outcome.not_reached"),
  ],
  nav_map_changed: [
    { kind: "navigation" },
    START,
    advance(1000),
    see("errors:api.map_changed"),
    shot("map-changed"),
    AXE,
  ],
  nav_refused: [
    { kind: "navigation" },
    START,
    advance(1000),
    see("errors:api.scenario_unavailable"),
    shot("refused"),
    AXE,
  ],
  nav_disconnect: [
    { kind: "navigation" },
    START,
    ...runToEnd("mission:navigation.outcome.success"),
  ],
  env_starting: [
    advance(2_500),
    see("mission:splash.startingTitle"),
    shot("booting"),
    advance(8_500),
    shot("ros-up"),
    advance(7_000),
    shot("ready"),
    START,
    ...RUN_TO_END,
  ],
  idle_ready: [shot("idle"), see("mission:splash.title"), AXE, START, ...RUN_TO_END],
  success: STANDARD,
  llm_fallback: [
    shot("idle"),
    START,
    advance(6_000),
    see("research:source.fallback"),
    shot("fallback"),
    ...RUN_TO_END,
  ],
  plan_revision: [
    shot("idle"),
    START,
    advance(6_500),
    see("research:label.revision"),
    shot("revision"),
    ...RUN_TO_END,
  ],
  medium_adaptation: STANDARD,
  hard_events: [
    shot("idle"),
    START,
    advance(5_500),
    shot("sensor-degraded"),
    advance(1_500),
    shot("hazard"),
    ...RUN_TO_END,
  ],
  slam_building: [shot("idle"), START, advance(1_000), shot("map-missing"), ...RUN_TO_END],
  team_success: [
    shot("idle"),
    START,
    ...runToEnd("team:outcome.success", "mission:teamOutcome.success"),
  ],
  team_partial: [
    shot("idle"),
    START,
    advance(11_000),
    see("team:robot.lost"),
    shot("partner-lost"),
    AXE,
    ...runToEnd("team:outcome.partial", "mission:teamOutcome.partial"),
  ],
  disconnect: [
    shot("idle"),
    START,
    advance(12_000),
    see("common:connection.stale"),
    shot("stale"),
    AXE,
    advance(10_000),
    shot("recovered"),
    ...RUN_TO_END,
  ],
  failed: [
    shot("idle"),
    START,
    ...runToEnd("mission:status.failed", "mission:teamOutcome.failed"),
  ],
  start_rejected: [
    shot("idle"),
    START,
    advance(500),
    see("mission:splash.rejectedTitle"),
    shot("rejected"),
    AXE,
    START,
    ...RUN_TO_END,
  ],
  command_unknown: [
    shot("idle"),
    START,
    advance(4_000),
    STOP,
    advance(200),
    shot("unknown"),
    AXE,
    advance(1_500),
    shot("reconciled"),
    RETRY,
    advance(2_000),
    shot("end"),
    AXE,
  ],
  stopped: [
    shot("idle"),
    START,
    ...runToEnd("mission:status.stopped", "mission:teamOutcome.stopped"),
  ],
  journal_long: [
    shot("idle"),
    START,
    ...RUN_TO_END,
    EXPORT,
    advance(2_000),
    see("journal:export.failed"),
    shot("export-failed"),
    AXE,
    EXPORT,
    advance(4_000),
    see("journal:export.done"),
    shot("exported"),
  ],
}

export const SCENARIO_ORDER = Object.keys(PLANS) as FixtureScenarioName[]
