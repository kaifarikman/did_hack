import type { LegendShape } from "../labels"
import type { MapPalette, MapRole } from "../mapTheme"
import { circle } from "./frame"
import { drawBaseGlyph, drawContourGlyph, drawGoalGlyph, drawRobotGlyph } from "./glyphs"
import { hatch } from "./hazards"
import { contour } from "./terrain"

export const SWATCH_WIDTH = 24
export const SWATCH_HEIGHT = 20

const GLYPH_SCALE = 0.62
const ROBOT_SHIFT = -2
const SAMPLE_SIZE = 20
const LINE_INSET = 3
const TRAIL_STEPS = 4
const PATH_DASH: number[] = [3, 5]
const NO_DASH: number[] = []
const AREA_RADIUS = 8
const CONTOUR_LEVELS = [1, 0.68, 0.38] as const
const STEP_RADIUS = 7
const CELL_INSET = 3

function drawLine(context: CanvasRenderingContext2D, color: string, faded: boolean): void {
  const midY = SWATCH_HEIGHT / 2
  const span = SWATCH_WIDTH - LINE_INSET * 2
  context.lineCap = "round"
  context.strokeStyle = color
  context.lineWidth = faded ? 2 : 2.5
  if (!faded) context.setLineDash(PATH_DASH)
  const steps = faded ? TRAIL_STEPS : 1
  for (let step = 0; step < steps; step += 1) {
    context.beginPath()
    context.moveTo(LINE_INSET + (span * step) / steps, midY)
    context.lineTo(LINE_INSET + (span * (step + 1)) / steps, midY)
    context.globalAlpha = faded ? (step + 1) / steps : 1
    context.stroke()
  }
  context.setLineDash(NO_DASH)
  context.globalAlpha = 1
}

function drawArea(
  context: CanvasRenderingContext2D,
  shape: "hazard" | "terrain",
  color: string,
): void {
  const x = SWATCH_WIDTH / 2
  const y = SWATCH_HEIGHT / 2
  context.fillStyle = color
  context.strokeStyle = color
  context.lineWidth = 1
  if (shape === "hazard") {
    hatch(context, x, y, AREA_RADIUS)
    circle(context, x, y, AREA_RADIUS)
    context.lineWidth = 1.5
    context.stroke()
    return
  }
  for (const level of CONTOUR_LEVELS) {
    contour(context, x, y, AREA_RADIUS, level)
    context.globalAlpha = 0.25
    context.fill()
    context.globalAlpha = 1
    context.stroke()
  }
}

export function drawLegendGlyph(
  context: CanvasRenderingContext2D,
  shape: LegendShape,
  role: MapRole,
  palette: MapPalette,
): void {
  const { css } = palette
  const color = css[role]
  const x = SWATCH_WIDTH / 2
  const y = SWATCH_HEIGHT / 2
  const mark = { line: color, halo: css.labelHalo, shadow: css.shadow }
  context.clearRect(0, 0, SWATCH_WIDTH, SWATCH_HEIGHT)
  if (shape === "robot") {
    const ink = {
      body: color,
      halo: css.labelHalo,
      wheel: css.label,
      accent: css.sampleCore,
      shadow: css.shadow,
    }
    drawRobotGlyph(context, x + ROBOT_SHIFT, y, 0, ink, GLYPH_SCALE)
  } else if (shape === "base") drawBaseGlyph(context, x, y, mark, GLYPH_SCALE * 1.2)
  else if (shape === "goal") drawGoalGlyph(context, x, y, mark, GLYPH_SCALE * 0.95)
  else if (shape === "sample")
    drawContourGlyph(context, x, y, SAMPLE_SIZE, mark, css.sampleCore)
  else if (shape === "trail" || shape === "path") drawLine(context, color, shape === "trail")
  else if (shape === "hazard" || shape === "terrain") drawArea(context, shape, color)
  else if (shape === "planStep") {
    circle(context, x, y, STEP_RADIUS)
    context.fillStyle = css.labelHalo
    context.fill()
    context.strokeStyle = color
    context.lineWidth = 1.5
    context.stroke()
  } else {
    context.fillStyle = color
    context.fillRect(
      CELL_INSET,
      CELL_INSET,
      SWATCH_WIDTH - CELL_INSET * 2,
      SWATCH_HEIGHT - CELL_INSET * 2,
    )
    context.strokeStyle = css.grid
    context.lineWidth = 1
    context.strokeRect(
      CELL_INSET,
      CELL_INSET,
      SWATCH_WIDTH - CELL_INSET * 2,
      SWATCH_HEIGHT - CELL_INSET * 2,
    )
  }
}
