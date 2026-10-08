import { motionMs, readEasing, readToken } from "@/ui/shared/motion"
import { type CanvasRole, readCanvasPalette } from "./canvasPalette"
import { parseColor, type Rgba, toCss } from "./color"
import { type Easing, linear, parseEasing } from "./easing"

export type MapRole = CanvasRole

export const MAP_ROLES = [
  "sample",
  "hazard",
  "robot",
  "robotPartner",
  "path",
  "planStep",
  "goal",
  "trail",
  "base",
  "grid",
  "unknown",
  "free",
  "obstacle",
  "soilLow",
  "soilHigh",
  "critical",
  "label",
  "labelHalo",
] as const satisfies readonly MapRole[]

export interface MapPalette {
  readonly rgba: Readonly<Record<MapRole, Rgba>>
  readonly css: Readonly<Record<MapRole, string>>
}

export interface MapTimings {
  readonly drawMs: number
  readonly eventMs: number
  readonly fadeMs: number
  readonly minTrackMs: number
  readonly maxTrackMs: number
  readonly easing: Easing
}

const OPAQUE_BLACK: Rgba = [0, 0, 0, 1]
const DEFAULT_FONT = "600 12px sans-serif"
const DEFAULT_STEP_FONT = "600 16px sans-serif"

function canRead(): boolean {
  return typeof document !== "undefined"
}

const OPAQUE = 255

function createProbe(): CanvasRenderingContext2D | null {
  if (!canRead()) return null
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  return canvas.getContext("2d", { willReadFrequently: true })
}

function resolveColor(probe: CanvasRenderingContext2D | null, value: string): Rgba | null {
  const parsed = parseColor(value)
  if (parsed !== null || probe === null || value === "") return parsed
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = value
  probe.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0, alpha = 0] = probe.getImageData(0, 0, 1, 1).data
  return [red, green, blue, alpha / OPAQUE]
}

export function readMapPalette(): MapPalette {
  const raw = canRead() ? readCanvasPalette() : null
  const probe = createProbe()
  const rgba = {} as Record<MapRole, Rgba>
  const css = {} as Record<MapRole, string>
  for (const role of MAP_ROLES) {
    rgba[role] = resolveColor(probe, raw?.[role] ?? "") ?? OPAQUE_BLACK
    css[role] = toCss(rgba[role])
  }
  return { rgba, css }
}

export function readMapTimings(reducedMotion: boolean): MapTimings {
  if (reducedMotion || !canRead()) {
    return { drawMs: 0, eventMs: 0, fadeMs: 0, minTrackMs: 0, maxTrackMs: 0, easing: linear }
  }
  return {
    drawMs: motionMs("--dur-draw"),
    eventMs: motionMs("--dur-slow"),
    fadeMs: motionMs("--dur-base"),
    minTrackMs: motionMs("--dur-fast"),
    maxTrackMs: motionMs("--dur-draw"),
    easing: parseEasing(readEasing("--ease-out")),
  }
}

function readFont(sizeToken: `--${string}`, fallback: string): string {
  if (!canRead()) return fallback
  const weight = readToken("--weight-semibold")
  const size = readToken(sizeToken)
  const family = readToken("--font-ui")
  return weight === "" || size === "" || family === ""
    ? fallback
    : `${weight} ${size} ${family}`
}

export function readMapFont(): string {
  return readFont("--font-size-caption", DEFAULT_FONT)
}

export function readMapStepFont(): string {
  return readFont("--font-size-body", DEFAULT_STEP_FONT)
}
