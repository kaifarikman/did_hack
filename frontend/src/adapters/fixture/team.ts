import type {
  ErrorInfo,
  GoalKind,
  MissionGoal,
  MissionSnapshot,
  Point,
  RobotPose,
  RunStatus,
  TeamOutcome,
  TeamRobotView,
} from "../../domain/contract"
import { FINISHED_STATUSES } from "../../domain/contract"
import { GOAL_REASONS, SAMPLE_PLACE } from "./baseline"
import { manhattanRoute, point, poseOnRoute, round, routeHeading, turnBetween } from "./route"
import type { FrameOverlay } from "./timeline"

export interface TeamOptions {
  finalOutcome: TeamOutcome
  lostAtFrame: number | null
  lostError: ErrorInfo | null
}

export const PARTNER_BASE: Point = point(-2, 0.5)
export const PARTNER_SAMPLE: Point = point(0, 0.5)
const PARTNER_COLLECT_FRAMES = 2
const PARTNER_BATTERY = 60

const outbound = manhattanRoute(PARTNER_BASE, PARTNER_SAMPLE)
const inbound = [...outbound].reverse()
const collectStart = outbound.length + 1
const returnStart = collectStart + PARTNER_COLLECT_FRAMES
const finishedAt = returnStart + inbound.length

function partnerPhase(index: number): "starting" | "outbound" | "collect" | "return" | "done" {
  if (index === 0) return "starting"
  if (index < collectStart) return "outbound"
  if (index < returnStart) return "collect"
  if (index < finishedAt) return "return"
  return "done"
}

function partnerTrajectory(index: number): Point[] {
  const travelled = [...outbound, ...inbound]
  const steps = Math.min(Math.max(index - 1, 0), outbound.length - 1)
  const back = Math.max(index - returnStart + 1, 0)
  return travelled.slice(0, steps + 1 + Math.min(back, inbound.length))
}

type PartnerPhase = ReturnType<typeof partnerPhase>

const PHASE_STATUS: Readonly<Record<PartnerPhase, RunStatus>> = {
  starting: "starting",
  outbound: "running",
  collect: "running",
  return: "returning",
  done: "completed",
}

const PHASE_GOAL: Readonly<Record<PartnerPhase, GoalKind | null>> = {
  starting: null,
  outbound: "approach",
  collect: "collect",
  return: "return",
  done: null,
}

function partnerPose(phase: PartnerPhase, index: number): RobotPose | null {
  if (phase === "starting") return null
  if (phase === "outbound") return poseOnRoute(outbound, index - 1)
  if (phase === "collect") {
    const pose = poseOnRoute(outbound, outbound.length - 1)
    const arrival = pose.heading_rad
    const departure = routeHeading(inbound, 0, arrival)
    const ratio = (index - collectStart + 1) / PARTNER_COLLECT_FRAMES
    return { ...pose, heading_rad: turnBetween(arrival, departure, ratio) }
  }
  return poseOnRoute(inbound, Math.min(index - returnStart, inbound.length - 1))
}

function partnerGoal(phase: PartnerPhase): MissionGoal | null {
  const kind = PHASE_GOAL[phase]
  if (kind === null) return null
  const target = phase === "return" ? PARTNER_BASE : PARTNER_SAMPLE
  return { kind, target, reason: GOAL_REASONS[kind] }
}

function partnerAt(index: number): TeamRobotView {
  const phase = partnerPhase(index)
  const pose = partnerPose(phase, index)
  const trajectory = partnerTrajectory(index)
  const holding = phase === "outbound" || phase === "collect"
  return {
    robot_id: "robot_2",
    status: PHASE_STATUS[phase],
    robot_pose: pose,
    battery_remaining:
      pose === null ? null : round(PARTNER_BATTERY - trajectory.length * 0.3, 2),
    samples_collected: phase === "return" || phase === "done" ? 1 : 0,
    current_goal: partnerGoal(phase),
    trajectory,
    planned_path: phase === "outbound" ? outbound.slice(index - 1, index + 5) : [],
    reservation: holding ? PARTNER_SAMPLE : null,
    last_error: null,
  }
}

function leaderOf(frame: MissionSnapshot): TeamRobotView {
  const reserving = frame.status === "running" && frame.samples_collected === 0
  return {
    robot_id: "robot_1",
    status: frame.status,
    robot_pose: frame.robot_pose,
    battery_remaining: frame.battery_remaining,
    samples_collected: frame.samples_collected,
    current_goal: frame.current_goal,
    trajectory: frame.trajectory,
    planned_path: frame.planned_path,
    reservation: reserving ? SAMPLE_PLACE : null,
    last_error: frame.last_error,
  }
}

function interrupted(partner: TeamRobotView, status: RunStatus): TeamRobotView {
  if (
    partner.status === "completed" ||
    !FINISHED_STATUSES.concat("stopping").includes(status)
  ) {
    return partner
  }
  return { ...partner, status, current_goal: null, planned_path: [], reservation: null }
}

export function teamLayer(options: TeamOptions): FrameOverlay {
  return (frame, index, marks) => {
    const lost = options.lostAtFrame !== null && index >= options.lostAtFrame
    const frozen = lost ? partnerAt(options.lostAtFrame ?? index) : partnerAt(index)
    const partner: TeamRobotView = lost
      ? {
          ...frozen,
          status: "failed",
          current_goal: null,
          planned_path: [],
          reservation: null,
          last_error: options.lostError,
        }
      : interrupted(frozen, frame.status)
    const robots = [leaderOf(frame), partner]
    const final = index === marks.finalIndex || FINISHED_STATUSES.includes(frame.status)
    return {
      team: {
        outcome: final ? options.finalOutcome : "running",
        samples_collected: robots.reduce((sum, robot) => sum + robot.samples_collected, 0),
        coordinated: !lost,
        lost_robots: lost ? [partner.robot_id] : [],
        robots,
      },
    }
  }
}
