import type { RobotPose } from "@/domain/contract"

export interface MutablePose {
  position_x_m: number
  position_y_m: number
  heading_rad: number
}

const FULL_TURN = Math.PI * 2

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

export function progress(now: number, start: number, duration: number): number {
  if (duration <= 0) return 1
  return clamp01((now - start) / duration)
}

export function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio
}

export function shortestAngle(from: number, to: number): number {
  const delta = ((((to - from) % FULL_TURN) + FULL_TURN * 1.5) % FULL_TURN) - Math.PI
  return delta
}

export function lerpAngle(from: number, to: number, ratio: number): number {
  return from + shortestAngle(from, to) * ratio
}

export function copyPose(target: MutablePose, source: RobotPose): MutablePose {
  target.position_x_m = source.position_x_m
  target.position_y_m = source.position_y_m
  target.heading_rad = source.heading_rad
  return target
}

export function interpolatePose(
  target: MutablePose,
  from: RobotPose,
  to: RobotPose,
  ratio: number,
): MutablePose {
  target.position_x_m = lerp(from.position_x_m, to.position_x_m, ratio)
  target.position_y_m = lerp(from.position_y_m, to.position_y_m, ratio)
  target.heading_rad = lerpAngle(from.heading_rad, to.heading_rad, ratio)
  return target
}

export function trackDuration(intervalMs: number, minMs: number, maxMs: number): number {
  if (maxMs <= 0) return 0
  return Math.min(Math.max(intervalMs, minMs), maxMs)
}
