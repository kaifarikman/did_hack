import type { CollectedSample, GoalKind, MissionSnapshot, Point } from "../../domain/contract"
import {
  BASE,
  GOAL_REASONS,
  MISSION_TEXT,
  runningTemplate,
  SAMPLE_PLACE,
  TERRAIN_CENTER,
} from "./baseline"
import {
  distance,
  manhattanRoute,
  poseOnRoute,
  round,
  routeHeading,
  turnBetween,
} from "./route"

export interface TimelineOptions {
  failAtReturnStep: number | null
  batteryInitial: number
  reserveMargin: number
}

export interface TimelineMarks {
  collectStart: number
  returnStart: number
  finalIndex: number
}

export interface MissionTimeline {
  frames: MissionSnapshot[]
  marks: TimelineMarks
}

const DEFAULT_OPTIONS: TimelineOptions = {
  failAtReturnStep: null,
  batteryInitial: runningTemplate.battery_initial,
  reserveMargin: 0.5,
}

const COLLECT_FRAMES = 3
const TRAJECTORY_LIMIT = 500
const COLLECTED: CollectedSample[] = [{ sample_id: "sample-1", position: SAMPLE_PLACE }]

function blankFrame(index: number, batteryInitial: number): MissionSnapshot {
  return {
    ...runningTemplate,
    simulation_time_s: index,
    battery_initial: batteryInitial,
    base_position: BASE,
    planner_mode: "llm",
    mission_text: MISSION_TEXT,
    target_samples: 1,
    collected_samples: [],
    samples_collected: 0,
    terrain_estimates: [],
    last_error: null,
    current_goal: null,
    planned_path: [],
    trajectory: [],
    plan: null,
    research: null,
    team: null,
  }
}

function terrainAt(index: number): MissionSnapshot["terrain_estimates"] {
  if (index < 6) return []
  const settled = index >= 24
  return [
    {
      region_id: "observed-area-1",
      center: TERRAIN_CENTER,
      radius_m: 0.3,
      energy_per_m: settled ? 2.0 : 2.1,
      confidence: settled ? 0.7 : 0.4,
      std_energy_per_m: settled ? 0.2 : 0.5,
      regime: 0,
      last_measured_s: index,
    },
  ]
}

function goalKindFor(returning: boolean, signal: number): GoalKind {
  if (returning) return "return"
  return signal > 0.8 ? "approach" : "explore"
}

export function buildMissionTimeline(
  overrides: Partial<TimelineOptions> = {},
): MissionTimeline {
  const options = { ...DEFAULT_OPTIONS, ...overrides }
  const outbound = manhattanRoute(BASE, SAMPLE_PLACE)
  const returning = [...outbound].reverse()
  const collectStart = outbound.length
  const returnStart = collectStart + COLLECT_FRAMES
  const frames: MissionSnapshot[] = []
  const trajectory: Point[] = []
  let battery = options.batteryInitial

  frames.push({
    ...blankFrame(0, options.batteryInitial),
    status: "starting",
    simulation_time_s: null,
    robot_pose: null,
    battery_remaining: null,
    sample_signal: null,
    return_energy_estimate: null,
  })

  const addMovingFrame = (
    index: number,
    route: Point[],
    routeIndex: number,
    back: boolean,
  ): void => {
    const pose = poseOnRoute(route, routeIndex)
    trajectory.push({ position_x_m: pose.position_x_m, position_y_m: pose.position_y_m })
    if (routeIndex > 0) battery -= distance(pose, TERRAIN_CENTER) <= 0.3 ? 0.5 : 0.3
    const signal = Math.max(0, 1 - distance(pose, SAMPLE_PLACE) / 2.2)
    const remaining = route.slice(routeIndex)
    const kind = goalKindFor(back, signal)
    frames.push({
      ...blankFrame(index, options.batteryInitial),
      status: back ? "returning" : "running",
      robot_pose: pose,
      battery_remaining: round(Math.max(battery, 0), 2),
      sample_signal: round(signal, 2),
      return_energy_estimate: round(distance(pose, BASE) * 0.4 + options.reserveMargin, 1),
      current_goal: {
        kind,
        target: remaining.length > 1 ? (remaining[remaining.length - 1] ?? null) : null,
        reason: GOAL_REASONS[kind],
      },
      trajectory: trajectory.slice(-TRAJECTORY_LIMIT),
      planned_path: remaining.slice(0, 6),
      collected_samples: back ? COLLECTED : [],
      samples_collected: back ? 1 : 0,
      terrain_estimates: terrainAt(index),
    })
  }

  for (let routeIndex = 0; routeIndex < outbound.length; routeIndex += 1) {
    addMovingFrame(routeIndex + 1, outbound, routeIndex, false)
  }
  const arrival = routeHeading(outbound, outbound.length - 2)
  const departure = routeHeading(returning, 0, arrival)
  for (let step = 0; step < COLLECT_FRAMES; step += 1) {
    const collected = step >= 1
    const last = frames[frames.length - 1] as MissionSnapshot
    const pose = last.robot_pose
    frames.push({
      ...last,
      robot_pose:
        pose === null
          ? null
          : {
              ...pose,
              heading_rad: turnBetween(arrival, departure, (step + 1) / COLLECT_FRAMES),
            },
      simulation_time_s: collectStart + 1 + step,
      current_goal: { kind: "collect", target: SAMPLE_PLACE, reason: GOAL_REASONS.collect },
      planned_path: [],
      sample_signal: 1,
      battery_remaining: round(Math.max(battery - 0.2 * (step + 1), 0), 2),
      samples_collected: collected ? 1 : 0,
      collected_samples: collected ? COLLECTED : [],
    })
  }
  battery -= 0.2 * COLLECT_FRAMES

  const returnSteps = options.failAtReturnStep ?? returning.length
  for (let step = 0; step < returnSteps; step += 1) {
    addMovingFrame(returnStart + 1 + step, returning, step, true)
  }

  const last = frames[frames.length - 1] as MissionSnapshot
  const finalIndex = frames.length
  const finalFrame: MissionSnapshot =
    options.failAtReturnStep !== null
      ? { ...last, status: "failed", current_goal: null, planned_path: [] }
      : {
          ...last,
          status: "completed",
          robot_pose: { ...BASE, heading_rad: last.robot_pose?.heading_rad ?? 0 },
          current_goal: null,
          planned_path: [],
          return_energy_estimate: 0,
        }
  frames.push({ ...finalFrame, simulation_time_s: finalIndex })
  return { frames, marks: { collectStart, returnStart, finalIndex } }
}

export type FrameOverlay = (
  frame: MissionSnapshot,
  index: number,
  marks: TimelineMarks,
) => Partial<MissionSnapshot>

export function overlay(
  timeline: MissionTimeline,
  ...layers: FrameOverlay[]
): MissionSnapshot[] {
  return timeline.frames.map((frame, index) => {
    let current = frame
    for (const layer of layers)
      current = { ...current, ...layer(current, index, timeline.marks) }
    return current
  })
}
