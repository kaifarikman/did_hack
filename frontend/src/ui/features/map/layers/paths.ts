import type { SceneRobot } from "../scene"
import { type LayerFrame, projectPath, screenX, screenY } from "./frame"

const TRAIL_WIDTH = 2
const TRAIL_BANDS = 8
const TRAIL_MIN_ALPHA = 0.12
const PLAN_WIDTH = 2.5
const PLAN_HALO_WIDTH = 6
const PLAN_HALO_ALPHA = 0.7
const PLAN_DASH: number[] = [3, 7]
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

interface TrailTail {
  last: number
  x: number
  y: number
  attached: boolean
}

const tail: TrailTail = { last: 0, x: 0, y: 0, attached: false }

function trailTail(frame: LayerFrame, robot: SceneRobot, coords: Float64Array): TrailTail {
  const pose = frame.motion.pose(robot.id)
  const target = frame.motion.target(robot.id)
  tail.last = coords.length / 2 - 1
  tail.attached = pose !== null && target !== null
  if (pose === null || target === null) return tail
  const { transform } = frame
  tail.x = screenX(transform, pose)
  tail.y = screenY(transform, pose)
  const targetX = screenX(transform, target)
  const targetY = screenY(transform, target)
  const ahead = Math.hypot(tail.x - targetX, tail.y - targetY)
  while (
    tail.last > 0 &&
    Math.hypot(
      (coords[tail.last * 2] ?? 0) - targetX,
      (coords[tail.last * 2 + 1] ?? 0) - targetY,
    ) < ahead
  )
    tail.last -= 1
  return tail
}

function strokeFadingTrail(
  context: CanvasRenderingContext2D,
  coords: Float64Array,
  baseAlpha: number,
  end: TrailTail,
): void {
  const segments = end.last
  for (let band = 0; band < TRAIL_BANDS; band += 1) {
    const from = Math.floor((band * segments) / TRAIL_BANDS)
    const to = Math.floor(((band + 1) * segments) / TRAIL_BANDS)
    const closing = band === TRAIL_BANDS - 1 && end.attached
    if (to <= from && !closing) continue
    context.beginPath()
    context.moveTo(coords[from * 2] ?? 0, coords[from * 2 + 1] ?? 0)
    for (let point = from + 1; point <= to; point += 1)
      context.lineTo(coords[point * 2] ?? 0, coords[point * 2 + 1] ?? 0)
    if (closing) context.lineTo(end.x, end.y)
    const weight = (band + 1) / TRAIL_BANDS
    context.globalAlpha =
      baseAlpha * (TRAIL_MIN_ALPHA + (1 - TRAIL_MIN_ALPHA) * weight * weight)
    context.stroke()
  }
  context.globalAlpha = 1
}

export function drawPaths(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now } = frame
  context.lineJoin = "round"
  context.lineCap = "round"
  for (const robot of scene.robots) {
    if (robot.trail.length > 1) {
      context.strokeStyle = robot.partner ? palette.css.robotPartner : palette.css.trail
      context.lineWidth = TRAIL_WIDTH
      const coords = projectPath(robot.trail, transform)
      strokeFadingTrail(
        context,
        coords,
        robot.partner ? PARTNER_TRAIL_ALPHA : 1,
        trailTail(frame, robot, coords),
      )
    }
    if (robot.plannedPath.length > 1 && !robot.lost) {
      const coords = projectPath(robot.plannedPath, transform)
      const drawn = pathLength(coords) * motion.routeProgress(robot.id, now)
      tracePrefix(context, coords, drawn)
      context.globalAlpha = PLAN_HALO_ALPHA
      context.strokeStyle = palette.css.labelHalo
      context.lineWidth = PLAN_HALO_WIDTH
      context.stroke()
      context.globalAlpha = 1
      context.setLineDash(PLAN_DASH)
      context.strokeStyle = robot.partner ? palette.css.robotPartner : palette.css.path
      context.lineWidth = PLAN_WIDTH
      context.stroke()
      context.setLineDash(NO_DASH)
    }
  }
}
