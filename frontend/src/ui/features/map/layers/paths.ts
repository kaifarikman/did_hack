import { type LayerFrame, projectPath } from "./frame"

const TRAIL_WIDTH = 2.5
const PLAN_WIDTH = 2.5
const PLAN_DASH: number[] = [7, 5]
const NO_DASH: number[] = []
const PARTNER_TRAIL_ALPHA = 0.6

export function pathLength(coords: Float64Array): number {
  let total = 0
  for (let index = 2; index < coords.length; index += 2) {
    total += Math.hypot(
      (coords[index] ?? 0) - (coords[index - 2] ?? 0),
      (coords[index + 1] ?? 0) - (coords[index - 1] ?? 0),
    )
  }
  return total
}

export function tracePrefix(
  context: CanvasRenderingContext2D,
  coords: Float64Array,
  length: number,
): void {
  context.beginPath()
  if (coords.length < 4) return
  context.moveTo(coords[0] ?? 0, coords[1] ?? 0)
  let remaining = length
  for (let index = 2; index < coords.length && remaining > 0; index += 2) {
    const fromX = coords[index - 2] ?? 0
    const fromY = coords[index - 1] ?? 0
    const toX = coords[index] ?? 0
    const toY = coords[index + 1] ?? 0
    const segment = Math.hypot(toX - fromX, toY - fromY)
    if (segment <= remaining) {
      context.lineTo(toX, toY)
    } else {
      const ratio = segment === 0 ? 0 : remaining / segment
      context.lineTo(fromX + (toX - fromX) * ratio, fromY + (toY - fromY) * ratio)
    }
    remaining -= segment
  }
}

export function drawPaths(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now } = frame
  context.lineJoin = "round"
  context.lineCap = "round"
  for (const robot of scene.robots) {
    const color = robot.partner ? palette.css.robotPartner : palette.css.trail
    if (robot.trail.length > 1) {
      const coords = projectPath(robot.trail, transform)
      tracePrefix(context, coords, Number.POSITIVE_INFINITY)
      context.globalAlpha = robot.partner ? PARTNER_TRAIL_ALPHA : 1
      context.strokeStyle = color
      context.lineWidth = TRAIL_WIDTH
      context.stroke()
      context.globalAlpha = 1
    }
    if (robot.plannedPath.length > 1 && !robot.lost) {
      const coords = projectPath(robot.plannedPath, transform)
      const drawn = pathLength(coords) * motion.routeProgress(robot.id, now)
      tracePrefix(context, coords, drawn)
      context.setLineDash(PLAN_DASH)
      context.strokeStyle = robot.partner ? palette.css.robotPartner : palette.css.path
      context.lineWidth = PLAN_WIDTH
      context.stroke()
      context.setLineDash(NO_DASH)
    }
  }
}
