import type { Point } from "@/domain/contract"
import { headingToScreenAngle } from "@/domain/geometry"
import type { SceneRobot } from "../scene"
import { circle, type LayerFrame, screenX, screenY } from "./frame"
import { drawRobotGlyph, ROBOT_RADIUS, type RobotInk } from "./glyphs"

const OUTLINE_WIDTH = 2
const RESERVATION_RADIUS_M = 0.4
const RESERVATION_MIN_RADIUS_M = 0.1
const RESERVATION_DASH: number[] = [3, 3]
const NO_DASH: number[] = []
const LOST_ALPHA = 0.55
const PULSE_REACH = 3.4
const PULSE_ALPHA = 0.55
const PULSE_WIDTH = 1.5
export const ROBOT_SCALE = 1.4
const ROBOT_SIZE = ROBOT_RADIUS * ROBOT_SCALE

export function reservationRadius(frame: LayerFrame, center: Point): number {
  const { bounds, scale } = frame.transform
  const room = Math.min(
    center.position_x_m - bounds.minX,
    bounds.maxX - center.position_x_m,
    center.position_y_m - bounds.minY,
    bounds.maxY - center.position_y_m,
  )
  return Math.max(Math.min(RESERVATION_RADIUS_M, room), RESERVATION_MIN_RADIUS_M) * scale
}

function drawReservation(frame: LayerFrame, robot: SceneRobot, color: string): void {
  const { context, transform, motion, now } = frame
  if (robot.reservation === null) return
  const opacity = motion.reservationOpacity(robot.id, now)
  circle(
    context,
    screenX(transform, robot.reservation),
    screenY(transform, robot.reservation),
    reservationRadius(frame, robot.reservation),
  )
  context.globalAlpha = opacity
  context.setLineDash(RESERVATION_DASH)
  context.strokeStyle = color
  context.lineWidth = OUTLINE_WIDTH
  context.stroke()
  context.setLineDash(NO_DASH)
  context.globalAlpha = 1
}

function robotColor(frame: LayerFrame, robot: SceneRobot): string {
  if (robot.lost) return frame.palette.css.critical
  return robot.partner ? frame.palette.css.robotPartner : frame.palette.css.robot
}

const robotInk = { body: "", halo: "", wheel: "", accent: "", shadow: "" }

function inkFor(frame: LayerFrame, color: string): RobotInk {
  const { css } = frame.palette
  robotInk.body = color
  robotInk.halo = css.labelHalo
  robotInk.wheel = css.label
  robotInk.accent = css.sampleCore
  robotInk.shadow = css.shadow
  return robotInk
}

function drawPulse(
  frame: LayerFrame,
  robot: SceneRobot,
  x: number,
  y: number,
  color: string,
): void {
  const ratio = frame.motion.scan.pulse(robot.id, frame.now)
  if (ratio < 0) return
  const eased = frame.easing(ratio)
  const { context } = frame
  circle(context, x, y, ROBOT_SIZE + (PULSE_REACH - 1) * ROBOT_SIZE * eased)
  context.globalAlpha = PULSE_ALPHA * (1 - ratio)
  context.strokeStyle = color
  context.lineWidth = PULSE_WIDTH
  context.stroke()
  context.globalAlpha = 1
}

function drawRobot(frame: LayerFrame, robot: SceneRobot): void {
  const { context, transform, motion } = frame
  const color = robotColor(frame, robot)
  if (robot.partner) drawReservation(frame, robot, color)
  const pose = motion.pose(robot.id)
  if (pose === null) return
  const x = screenX(transform, pose)
  const y = screenY(transform, pose)
  if (!robot.lost) drawPulse(frame, robot, x, y, color)
  context.globalAlpha = robot.lost ? LOST_ALPHA : 1
  drawRobotGlyph(
    context,
    x,
    y,
    headingToScreenAngle(pose.heading_rad),
    inkFor(frame, color),
    ROBOT_SCALE,
  )
  context.globalAlpha = 1
}

export function drawRobots(frame: LayerFrame): void {
  for (const robot of frame.scene.robots) if (robot.partner) drawRobot(frame, robot)
  for (const robot of frame.scene.robots) if (!robot.partner) drawRobot(frame, robot)
}
