import type { Point, TerrainEstimate } from "@/domain/contract"
import type { ViewTransform } from "@/domain/geometry"
import type { MapMotion } from "../animation/motion"
import { mixColor, toCss } from "../color"
import type { Easing } from "../easing"
import type { MapPalette } from "../mapTheme"
import type { MapScene } from "../scene"
import type { LabelSink } from "./labels"

export interface MapLabelText {
  terrain(estimate: TerrainEstimate): string
  hazard(hits: number): string
}

export interface LayerFrame {
  readonly context: CanvasRenderingContext2D
  readonly transform: ViewTransform
  readonly palette: MapPalette
  readonly motion: MapMotion
  readonly scene: MapScene
  readonly labels: LabelSink
  readonly text: MapLabelText
  readonly now: number
  readonly easing: Easing
}

interface Projection {
  transform: ViewTransform
  coords: Float64Array
}

const projections = new WeakMap<readonly Point[], Projection>()
const ramps = new WeakMap<MapPalette, readonly string[]>()
const RAMP_STEPS = 32

export function projectPath(path: readonly Point[], transform: ViewTransform): Float64Array {
  const cached = projections.get(path)
  if (cached !== undefined && cached.transform === transform) return cached.coords
  const coords = new Float64Array(path.length * 2)
  path.forEach((place, index) => {
    coords[index * 2] = screenX(transform, place)
    coords[index * 2 + 1] = screenY(transform, place)
  })
  projections.set(path, { transform, coords })
  return coords
}

export function screenX(transform: ViewTransform, place: Point): number {
  return transform.offsetX + (place.position_x_m - transform.bounds.minX) * transform.scale
}

export function screenY(transform: ViewTransform, place: Point): number {
  return transform.offsetY + (transform.bounds.maxY - place.position_y_m) * transform.scale
}

export function soilRamp(palette: MapPalette): readonly string[] {
  const cached = ramps.get(palette)
  if (cached !== undefined) return cached
  const ramp = Array.from({ length: RAMP_STEPS }, (_, step) =>
    toCss(mixColor(palette.rgba.soilLow, palette.rgba.soilHigh, step / (RAMP_STEPS - 1))),
  )
  ramps.set(palette, ramp)
  return ramp
}

export function rampColor(ramp: readonly string[], ratio: number): string {
  const index = Math.round(Math.min(Math.max(ratio, 0), 1) * (ramp.length - 1))
  return ramp[index] ?? ramp[0] ?? ""
}

export function circle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  context.beginPath()
  context.arc(x, y, Math.max(radius, 0), 0, Math.PI * 2)
}
