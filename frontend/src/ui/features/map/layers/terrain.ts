import { circle, type LayerFrame, rampColor, screenX, screenY, soilRamp } from "./frame"

const TERRAIN_BASE_ALPHA = 0.1
const TERRAIN_CONFIDENCE_ALPHA = 0.22
const TERRAIN_LINE_ALPHA = 0.55
const TERRAIN_LABEL_CONFIDENCE = 0.25
const CONTOUR_LEVELS = [1, 0.68, 0.38] as const
const CONTOUR_DRIFT_X = 0.1
const CONTOUR_DRIFT_Y = -0.08
const LABEL_GAP = 4

export function contour(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  level: number,
): void {
  const drift = 1 - level
  circle(
    context,
    x + radius * CONTOUR_DRIFT_X * drift,
    y + radius * CONTOUR_DRIFT_Y * drift,
    radius * level,
  )
}

export function drawTerrain(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now, labels, text } = frame
  const ramp = soilRamp(palette)
  for (const estimate of scene.terrain) {
    const look = motion.terrainLook(estimate, now)
    const x = screenX(transform, estimate.center)
    const y = screenY(transform, estimate.center)
    const radius = estimate.radius_m * transform.scale
    const color = rampColor(ramp, look.cost)
    const alpha = TERRAIN_BASE_ALPHA + TERRAIN_CONFIDENCE_ALPHA * look.confidence
    context.fillStyle = color
    context.strokeStyle = color
    for (const level of CONTOUR_LEVELS) {
      contour(context, x, y, radius, level)
      context.globalAlpha = alpha
      context.fill()
      context.globalAlpha = TERRAIN_LINE_ALPHA + (1 - TERRAIN_LINE_ALPHA) * look.confidence
      context.lineWidth = level === 1 && estimate.regime > 0 ? 2 : 1
      context.stroke()
    }
    context.globalAlpha = 1
    if (estimate.confidence >= TERRAIN_LABEL_CONFIDENCE) {
      labels.add(
        context,
        text.terrain(estimate),
        x,
        y + LABEL_GAP,
        palette.css.label,
        y + radius + LABEL_GAP + labels.labelHeight,
      )
    }
  }
}
