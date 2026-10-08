import { lerp } from "../animation/interpolate"
import { circle, type LayerFrame, screenX, screenY } from "./frame"
import { drawContourGlyph } from "./glyphs"

const SAMPLE_HALF_SIZE = 11
const POP_START_SCALE = 0.6
const RING_END_SCALE = 2.4
const SAMPLE_SIZE = 26
const RING_WIDTH = 2

export function samplePop(ratio: number): {
  scale: number
  opacity: number
  ringScale: number
  ringAlpha: number
} {
  return {
    scale: lerp(POP_START_SCALE, 1, ratio),
    opacity: ratio,
    ringScale: lerp(1, RING_END_SCALE, ratio),
    ringAlpha: ratio >= 1 ? 0 : 1 - ratio,
  }
}

const sampleInk = { line: "", halo: "", shadow: "" }

export function drawSamples(frame: LayerFrame): void {
  const { context, transform, palette, motion, scene, now } = frame
  sampleInk.line = palette.css.sample
  sampleInk.halo = palette.css.labelHalo
  sampleInk.shadow = palette.css.shadow
  for (const sample of scene.samples) {
    const x = screenX(transform, sample.position)
    const y = screenY(transform, sample.position)
    const ratio = motion.eventProgress(`sample:${sample.sample_id}`, now)
    const pop = samplePop(frame.easing(ratio))
    context.globalAlpha = pop.opacity
    drawContourGlyph(context, x, y, SAMPLE_SIZE * pop.scale, sampleInk, palette.css.sampleCore)
    context.globalAlpha = 1
    if (pop.ringAlpha > 0) {
      circle(context, x, y, SAMPLE_HALF_SIZE * pop.ringScale)
      context.globalAlpha = pop.ringAlpha
      context.strokeStyle = palette.css.sampleCore
      context.lineWidth = RING_WIDTH
      context.stroke()
      context.globalAlpha = 1
    }
  }
}
