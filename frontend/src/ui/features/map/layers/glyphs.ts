import { circle } from "./frame"

export interface RobotInk {
  readonly body: string
  readonly halo: string
  readonly wheel: string
  readonly accent: string
  readonly shadow: string
}

export interface MarkInk {
  readonly line: string
  readonly halo: string
  readonly shadow: string
}

export const ROBOT_RADIUS = 11
const WHEEL_LENGTH = 10
const WHEEL_WIDTH = 4.5
const WHEEL_SIDE = 10.5
const WHEEL_FORWARD = 1.5
const NOSE_TIP = 18
const NOSE_BASE = 7
const NOSE_HALF = 5.5
const PLATE_RATIO = 0.66
const PUCK_RADIUS = 3.8
const PUCK_BACK = -2
const PUCK_DOT = 1.6
const HALO_WIDTH = 3
const SHADOW_DROP = 2
const BRAND_SCALE = 48
const BRAND_CENTER = 24.6
const BRAND_DOT = 3.6
const BRAND_LINE = 2.8
const BRAND_HALO = 3.4
const BRAND_OUTER = [
  8, 26, 8, 14, 18, 7, 28, 9, 38, 11, 42, 20, 40, 29, 38, 38, 28, 42, 19, 40, 11, 38, 8, 33, 8,
  26,
]
const BRAND_INNER = [
  15, 25, 15, 18, 21, 14, 27, 15.5, 33, 17, 35, 22, 33.5, 27.5, 32, 32.5, 26, 35, 21, 33.8, 17,
  32.8, 15, 29.5, 15, 25,
]
const HOUSE = [0, -10, 9.5, -1.5, 9.5, 9, -9.5, 9, -9.5, -1.5]
const HOUSE_INNER = 0.5
const DOOR_RADIUS = 2
const GOAL_OUTER = 10
const GOAL_INNER = 5
const GOAL_TICK_FROM = 12.5
const GOAL_TICK_TO = 16.5
const GOAL_DOT = 1.8
const GOAL_WIDTH = 2
const GOAL_INNER_WIDTH = 1.25

function wheel(context: CanvasRenderingContext2D, side: number): void {
  context.rect(
    WHEEL_FORWARD - WHEEL_LENGTH / 2,
    side * WHEEL_SIDE - WHEEL_WIDTH / 2,
    WHEEL_LENGTH,
    WHEEL_WIDTH,
  )
}

function inkOutline(context: CanvasRenderingContext2D, halo: string, fill: string): void {
  context.strokeStyle = halo
  context.lineWidth = HALO_WIDTH
  context.stroke()
  context.fillStyle = fill
  context.fill()
}

export function drawRobotGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  ink: RobotInk,
  scale = 1,
): void {
  context.save()
  context.translate(x, y)
  context.scale(scale, scale)
  circle(context, 0, SHADOW_DROP, ROBOT_RADIUS + HALO_WIDTH)
  context.fillStyle = ink.shadow
  context.fill()
  context.rotate(angle)
  context.lineJoin = "round"
  context.beginPath()
  wheel(context, 1)
  wheel(context, -1)
  inkOutline(context, ink.halo, ink.wheel)
  context.beginPath()
  context.moveTo(NOSE_TIP, 0)
  context.lineTo(NOSE_BASE, NOSE_HALF)
  context.lineTo(NOSE_BASE, -NOSE_HALF)
  context.closePath()
  inkOutline(context, ink.halo, ink.body)
  circle(context, 0, 0, ROBOT_RADIUS)
  inkOutline(context, ink.halo, ink.body)
  circle(context, 0, 0, ROBOT_RADIUS * PLATE_RATIO)
  context.strokeStyle = ink.halo
  context.globalAlpha *= 0.4
  context.lineWidth = 1
  context.stroke()
  context.globalAlpha /= 0.4
  circle(context, PUCK_BACK, 0, PUCK_RADIUS)
  context.fillStyle = ink.halo
  context.fill()
  circle(context, PUCK_BACK, 0, PUCK_DOT)
  context.fillStyle = ink.accent
  context.fill()
  context.restore()
}

function curve(context: CanvasRenderingContext2D, points: readonly number[]): void {
  context.moveTo(points[0] ?? 0, points[1] ?? 0)
  for (let index = 2; index + 5 < points.length; index += 6) {
    context.bezierCurveTo(
      points[index] ?? 0,
      points[index + 1] ?? 0,
      points[index + 2] ?? 0,
      points[index + 3] ?? 0,
      points[index + 4] ?? 0,
      points[index + 5] ?? 0,
    )
  }
  context.closePath()
}

export function drawContourGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  ink: MarkInk,
  core: string,
): void {
  const scale = size / BRAND_SCALE
  context.save()
  context.translate(x - BRAND_CENTER * scale, y - BRAND_CENTER * scale)
  context.scale(scale, scale)
  context.lineJoin = "round"
  context.beginPath()
  curve(context, BRAND_OUTER)
  context.fillStyle = ink.halo
  context.fill()
  curve(context, BRAND_INNER)
  context.strokeStyle = ink.halo
  context.lineWidth = BRAND_LINE + BRAND_HALO
  context.stroke()
  context.strokeStyle = ink.line
  context.lineWidth = BRAND_LINE
  context.stroke()
  circle(context, BRAND_CENTER, BRAND_CENTER, BRAND_DOT)
  context.fillStyle = core
  context.fill()
  context.restore()
}

function house(context: CanvasRenderingContext2D, ratio: number): void {
  context.moveTo((HOUSE[0] ?? 0) * ratio, (HOUSE[1] ?? 0) * ratio)
  for (let index = 2; index + 1 < HOUSE.length; index += 2)
    context.lineTo((HOUSE[index] ?? 0) * ratio, (HOUSE[index + 1] ?? 0) * ratio)
  context.closePath()
}

export function drawBaseGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  ink: MarkInk,
  scale = 1,
): void {
  context.save()
  context.translate(x, y)
  context.scale(scale, scale)
  context.lineJoin = "round"
  context.beginPath()
  context.translate(0, SHADOW_DROP)
  house(context, 1)
  context.fillStyle = ink.shadow
  context.fill()
  context.translate(0, -SHADOW_DROP)
  context.beginPath()
  house(context, 1)
  context.fillStyle = ink.halo
  context.fill()
  context.strokeStyle = ink.line
  context.lineWidth = GOAL_WIDTH
  context.stroke()
  context.beginPath()
  house(context, HOUSE_INNER)
  context.lineWidth = GOAL_INNER_WIDTH
  context.stroke()
  circle(context, 0, 0, DOOR_RADIUS)
  context.fillStyle = ink.line
  context.fill()
  context.restore()
}

export function drawGoalGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  ink: MarkInk,
  scale = 1,
): void {
  context.save()
  context.translate(x, y)
  context.scale(scale, scale)
  context.lineCap = "round"
  context.beginPath()
  context.arc(0, 0, GOAL_OUTER, 0, Math.PI * 2)
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const dx = quarter === 0 ? 1 : quarter === 2 ? -1 : 0
    const dy = quarter === 1 ? 1 : quarter === 3 ? -1 : 0
    context.moveTo(dx * GOAL_TICK_FROM, dy * GOAL_TICK_FROM)
    context.lineTo(dx * GOAL_TICK_TO, dy * GOAL_TICK_TO)
  }
  context.strokeStyle = ink.halo
  context.lineWidth = GOAL_WIDTH + HALO_WIDTH
  context.stroke()
  context.strokeStyle = ink.line
  context.lineWidth = GOAL_WIDTH
  context.stroke()
  circle(context, 0, 0, GOAL_INNER)
  context.lineWidth = GOAL_INNER_WIDTH
  context.stroke()
  circle(context, 0, 0, GOAL_DOT)
  context.fillStyle = ink.line
  context.fill()
  context.restore()
}
