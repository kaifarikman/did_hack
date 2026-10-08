import { lerp } from "../animation/interpolate"
import { hazardKey } from "../scene"
import { circle, type LayerFrame, screenX, screenY } from "./frame"

const HAZARD_DASH: number[] = [6, 3]
const NO_DASH: number[] = []
const HAZARD_FILL_ALPHA = 0.14
const MARK_START_WIDTH = 6
const MARK_END_WIDTH = 1.5
const MARK_GROWTH = 0.35
const LABEL_GAP = 2

export function appearMark(ratio: number): { widthPx: number; growth: number; alpha: number } {
  return {
    widthPx: lerp(MARK_START_WIDTH, MARK_END_WIDTH, ratio),
    growth: 1 + MARK_GROWTH * ratio,
    alpha: 1 - ratio,
  }
}

export function drawHazards(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now, labels, text } = frame
  for (const hazard of scene.hazards) {
    const x = screenX(transform, hazard.center)
    const y = screenY(transform, hazard.center)
    const radius = hazard.radius_m * transform.scale
    circle(context, x, y, radius)
    context.globalAlpha = HAZARD_FILL_ALPHA
    context.fillStyle = palette.css.hazard
    context.fill()
    context.globalAlpha = 1
    context.setLineDash(HAZARD_DASH)
    context.strokeStyle = palette.css.hazard
    context.lineWidth = 2
    context.stroke()
    context.setLineDash(NO_DASH)
    const ratio = motion.eventProgress(`hazard:${hazardKey(hazard)}`, now)
    if (ratio < 1) {
      const mark = appearMark(frame.easing(ratio))
      circle(context, x, y, radius * mark.growth)
      context.globalAlpha = mark.alpha
      context.lineWidth = mark.widthPx
      context.stroke()
      context.globalAlpha = 1
    }
    labels.add(
      context,
      text.hazard(hazard.hits),
      x,
      y - radius - LABEL_GAP,
      palette.css.hazard,
      y + radius + LABEL_GAP + labels.labelHeight,
    )
  }
}
