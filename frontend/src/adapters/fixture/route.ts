import type { Point, RobotPose } from "../../domain/contract"

const ROUTE_STEP_M = 0.1

export function point(x: number, y: number): Point {
  return { position_x_m: Number(x.toFixed(3)), position_y_m: Number(y.toFixed(3)) }
}

export function distance(first: Point, second: Point): number {
  return Math.hypot(
    first.position_x_m - second.position_x_m,
    first.position_y_m - second.position_y_m,
  )
}

function headingBetween(from: Point, to: Point): number {
  return Math.atan2(to.position_y_m - from.position_y_m, to.position_x_m - from.position_x_m)
}

export function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits))
}

function stepToward(current: number, target: number): number {
  if (current < target) return Math.min(current + ROUTE_STEP_M, target)
  return Math.max(current - ROUTE_STEP_M, target)
}

export function manhattanRoute(from: Point, to: Point): Point[] {
  let current = point(from.position_x_m, from.position_y_m)
  const route: Point[] = [current]
  while (Math.abs(current.position_x_m - to.position_x_m) > 1e-9) {
    current = point(stepToward(current.position_x_m, to.position_x_m), current.position_y_m)
    route.push(current)
  }
  while (Math.abs(current.position_y_m - to.position_y_m) > 1e-9) {
    current = point(current.position_x_m, stepToward(current.position_y_m, to.position_y_m))
    route.push(current)
  }
  return route
}

const FULL_TURN = Math.PI * 2

function segmentHeading(route: readonly Point[], index: number): number | null {
  const from = route[index]
  const to = route[index + 1]
  if (from === undefined || to === undefined || distance(from, to) === 0) return null
  return headingBetween(from, to)
}

export function routeHeading(route: readonly Point[], index: number, fallback = 0): number {
  for (let back = index; back >= 0; back -= 1) {
    const heading = segmentHeading(route, back)
    if (heading !== null) return heading
  }
  for (let ahead = index + 1; ahead < route.length - 1; ahead += 1) {
    const heading = segmentHeading(route, ahead)
    if (heading !== null) return heading
  }
  return fallback
}

export function poseOnRoute(
  route: readonly Point[],
  index: number,
  fallbackHeading = 0,
): RobotPose {
  const last = route.length - 1
  const clamped = Math.min(Math.max(index, 0), last)
  const position = route[clamped] ?? point(0, 0)
  const segment = clamped === last ? clamped - 1 : clamped
  return {
    ...position,
    heading_rad: round(routeHeading(route, segment, fallbackHeading), 3),
  }
}

export function turnBetween(from: number, to: number, ratio: number): number {
  let delta = (to - from) % FULL_TURN
  if (delta > Math.PI) delta -= FULL_TURN
  if (delta <= -Math.PI) delta += FULL_TURN
  return round(from + delta * Math.min(Math.max(ratio, 0), 1), 3)
}
