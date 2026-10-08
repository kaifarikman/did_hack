import { circle, type LayerFrame, rampColor, screenX, screenY, soilRamp } from "./frame"

const TERRAIN_BASE_ALPHA = 0.15
const TERRAIN_CONFIDENCE_ALPHA = 0.45
const TERRAIN_LABEL_CONFIDENCE = 0.25
const TERRAIN_DASH: number[] = [4, 3]
const NO_DASH: number[] = []
const LABEL_GAP = 4

export function drawTerrain(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now, labels, text } = frame
  const ramp = soilRamp(palette)
  for (const estimate of scene.terrain) {
    const look = motion.terrainLook(estimate, now)
    const x = screenX(transform, estimate.center)
    const y = screenY(transform, estimate.center)
    const radius = estimate.radius_m * transform.scale
    circle(context, x, y, radius)
    context.globalAlpha = TERRAIN_BASE_ALPHA + TERRAIN_CONFIDENCE_ALPHA * look.confidence
    context.fillStyle = rampColor(ramp, look.cost)
    context.fill()
    context.globalAlpha = 1
    context.setLineDash(TERRAIN_DASH)
    context.strokeStyle = palette.css.soilHigh
    context.lineWidth = estimate.regime > 0 ? 2.5 : 1
    context.stroke()
    context.setLineDash(NO_DASH)
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
