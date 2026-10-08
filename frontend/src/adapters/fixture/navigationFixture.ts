import type {
  JournalEntry,
  MissionSnapshot,
  NavigationPhase,
  NavigationTarget,
  Point,
} from "../../domain/contract"
import { parseSnapshot } from "../../domain/validation"
import navigationContent from "./examples/content/navigation.json"
import stateRunningExample from "./examples/state-running.json"

export type NavigationFixtureScenario =
  | "nav_success"
  | "nav_not_reached"
  | "nav_map_changed"
  | "nav_refused"
  | "nav_disconnect"

export const ARRIVAL_TOLERANCE_M = 0.12
export const NAVIGATION_SCHEMA_VERSION = "1.4"

const template: MissionSnapshot = parseSnapshot(stateRunningExample)

function round(value: number): number {
  return Number(value.toFixed(3))
}

function heading(from: Point, to: Point): number {
  return round(
    Math.atan2(to.position_y_m - from.position_y_m, to.position_x_m - from.position_x_m),
  )
}

type EntryDraft = Omit<JournalEntry, "sequence">

function entry(
  frame: number,
  kind: JournalEntry["kind"],
  title: string,
  detail: string,
): EntryDraft {
  return {
    simulation_time_s: frame,
    kind,
    title,
    detail,
    hypothesis_id: null,
    expected: null,
    observed: null,
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }
}

export interface NavigationScript {
  frames: MissionSnapshot[]
  journal: Array<{ atFrame: number; entry: EntryDraft }>
}

export interface NavigationScriptInput {
  scenario: NavigationFixtureScenario
  target: NavigationTarget
  route: Point[]
  base: Point
  mapId: string
}

export function buildNavigationScript(input: NavigationScriptInput): NavigationScript {
  const { scenario, target, route, base, mapId } = input
  const notReachedAt =
    scenario === "nav_not_reached" ? Math.max(Math.floor(route.length / 2), 1) : null
  const outbound = notReachedAt === null ? route : route.slice(0, notReachedAt + 1)
  const journal: NavigationScript["journal"] = []
  const frames: MissionSnapshot[] = []
  let battery = template.battery_initial
  let tick = 0
  let reachedAt: number | null = null
  const trajectory: Point[] = []

  const frame = (
    status: MissionSnapshot["status"],
    phase: NavigationPhase,
    patch: Partial<MissionSnapshot>,
  ): MissionSnapshot => ({
    ...template,
    schema_version: NAVIGATION_SCHEMA_VERSION,
    status,
    task_type: "navigation",
    map_id: mapId,
    base_position: base,
    simulation_time_s: tick,
    mission_text: "",
    target_samples: null,
    plan: null,
    research: null,
    terrain_estimates: [],
    collected_samples: [],
    samples_collected: 0,
    sample_signal: null,
    return_energy_estimate: null,
    last_error: null,
    current_goal: null,
    planned_path: [],
    trajectory: [...trajectory],
    navigation: {
      target,
      phase,
      target_reached: reachedAt !== null,
      target_reached_at_s: reachedAt,
      arrival_tolerance_m: ARRIVAL_TOLERANCE_M,
    },
    ...patch,
  })

  frames.push(
    frame("starting", "pending", {
      simulation_time_s: null,
      robot_pose: null,
      battery_remaining: null,
    }),
  )
  journal.push({
    atFrame: 0,
    entry: entry(
      0,
      "decision",
      "navigation_target_set",
      navigationContent.text1
        .replace("{x}", String(target.position_x_m))
        .replace("{y}", String(target.position_y_m))
        .replace("{mapId}", mapId),
    ),
  })

  const move = (
    points: Point[],
    index: number,
    status: MissionSnapshot["status"],
    phase: NavigationPhase,
    kind: "approach" | "return",
    reason: string,
  ): void => {
    tick += 1
    const position = points[index] as Point
    const next = points[Math.min(index + 1, points.length - 1)] as Point
    const previousPoint = points[Math.max(index - 1, 0)] as Point
    trajectory.push(position)
    if (index > 0) battery -= 0.4
    const remaining = points.slice(index)
    frames.push(
      frame(status, phase, {
        robot_pose: {
          position_x_m: position.position_x_m,
          position_y_m: position.position_y_m,
          heading_rad:
            index === points.length - 1
              ? heading(previousPoint, position)
              : heading(position, next),
        },
        battery_remaining: round(battery),
        return_energy_estimate: round(0.4 * (route.length - 1) + 0.5),
        current_goal: {
          kind,
          target: remaining.length > 1 ? (remaining[remaining.length - 1] as Point) : null,
          reason,
        },
        planned_path: remaining.slice(0, 8),
        route_revision: 1,
      }),
    )
  }

  for (let index = 0; index < outbound.length; index += 1)
    move(outbound, index, "running", "moving_to_target", "approach", navigationContent.text2)

  if (notReachedAt === null) {
    reachedAt = tick
    journal.push({
      atFrame: tick,
      entry: entry(tick, "outcome", "navigation_target_reached", navigationContent.text3),
    })
    const last = frames[frames.length - 1] as MissionSnapshot
    frames[frames.length - 1] = {
      ...last,
      status: "returning",
      navigation: {
        ...(last.navigation as NonNullable<MissionSnapshot["navigation"]>),
        phase: "returning",
        target_reached: true,
        target_reached_at_s: reachedAt,
      },
      current_goal: { kind: "return", target: base, reason: navigationContent.text4 },
    }
  } else {
    journal.push({
      atFrame: tick,
      entry: entry(tick, "error", navigationContent.text5, navigationContent.text6),
    })
  }
  journal.push({
    atFrame: tick,
    entry: entry(tick, "decision", "navigation_return_started", navigationContent.text7),
  })

  const back = [...outbound].reverse()
  for (let index = 1; index < back.length; index += 1)
    move(back, index, "returning", "returning", "return", navigationContent.text8)

  tick += 1
  const last = frames[frames.length - 1] as MissionSnapshot
  if (notReachedAt === null) {
    frames.push(
      frame("completed", "finished", {
        robot_pose: { ...base, heading_rad: last.robot_pose?.heading_rad ?? 0 },
        battery_remaining: last.battery_remaining,
        trajectory: [...trajectory],
        route_revision: 1,
      }),
    )
    journal.push({
      atFrame: tick,
      entry: entry(tick, "outcome", navigationContent.text9, navigationContent.text10),
    })
  } else {
    frames.push(
      frame("failed", "failed", {
        robot_pose: { ...base, heading_rad: last.robot_pose?.heading_rad ?? 0 },
        battery_remaining: last.battery_remaining,
        last_error: {
          code: "navigation_goal_not_reached",
          message: navigationContent.text11,
          retryable: false,
        },
        route_revision: 1,
      }),
    )
    journal.push({
      atFrame: tick,
      entry: entry(tick, "error", "navigation_goal_not_reached", navigationContent.text12),
    })
  }
  return { frames, journal }
}
