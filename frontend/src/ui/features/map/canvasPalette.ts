import { readToken } from "@/ui/shared/motion"

const CANVAS_TOKENS = {
  sample: "--data-sample",
  hazard: "--data-hazard",
  robot: "--data-robot",
  robotPartner: "--data-robot-partner",
  path: "--data-path",
  planStep: "--data-plan-step",
  goal: "--data-goal",
  trail: "--data-trail",
  base: "--data-base",
  grid: "--data-grid",
  unknown: "--data-unknown",
  free: "--data-free",
  obstacle: "--data-obstacle",
  soilLow: "--data-soil-low",
  soilHigh: "--data-soil-high",
  critical: "--data-critical",
  label: "--data-label",
  labelHalo: "--data-label-halo",
} as const

export type CanvasRole = keyof typeof CANVAS_TOKENS

export type CanvasPalette = Readonly<Record<CanvasRole, string>>

export function readCanvasPalette(element?: Element): CanvasPalette {
  const entries = Object.entries(CANVAS_TOKENS).map(([role, token]) => [
    role,
    readToken(token, element),
  ])
  return Object.fromEntries(entries) as CanvasPalette
}
