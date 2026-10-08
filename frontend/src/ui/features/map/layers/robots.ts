import type { Point, RobotPose } from "@/domain/contract"
import { headingToScreenAngle } from "@/domain/geometry"
import type { SceneRobot } from "../scene"
import { circle, type LayerFrame, screenX, screenY } from "./frame"

const NOSE = 18
const TAIL = 12
const NOTCH = 6
const OUTLINE_WIDTH = 2
const RESERVATION_RADIUS_M = 0.4
const RESERVATION_MIN_RADIUS_M = 0.1
const RESERVATION_DASH: number[] = [3, 3]
const NO_DASH: number[] = []
const LOST_ALPHA = 0.55

function drawBody(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  pose: RobotPose,
): void {
  context.save()
  context.translate(x, y)
  context.rotate(headingToScreenAngle(pose.heading_rad))
  context.beginPath()
  context.moveTo(NOSE, 0)
  context.lineTo(-TAIL, TAIL)
  context.lineTo(-NOTCH, 0)
  context.lineTo(-TAIL, -TAIL)
  context.closePath()
  context.restore()
}

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

export function robotColor(frame: LayerFrame, robot: SceneRobot): string {
  if (robot.lost) return frame.palette.css.critical
  return robot.partner ? frame.palette.css.robotPartner : frame.palette.css.robot
}

function drawRobot(frame: LayerFrame, robot: SceneRobot): void {
  const { context, transform, palette, motion } = frame
  const color = robotColor(frame, robot)
  if (robot.partner) drawReservation(frame, robot, color)
  const pose = motion.pose(robot.id)
  if (pose === null) return
  drawBody(context, screenX(transform, pose), screenY(transform, pose), pose)
  context.globalAlpha = robot.lost ? LOST_ALPHA : 1
  context.fillStyle = color
  context.fill()
  context.strokeStyle = palette.css.labelHalo
  context.lineWidth = OUTLINE_WIDTH
  context.stroke()
  context.globalAlpha = 1
}

export function drawRobots(frame: LayerFrame): void {
  for (const robot of frame.scene.robots) if (robot.partner) drawRobot(frame, robot)
  for (const robot of frame.scene.robots) if (!robot.partner) drawRobot(frame, robot)
}
