import { useEffect, useRef } from "react"
import type { LegendShape } from "../labels"
import { drawLegendGlyph, SWATCH_HEIGHT, SWATCH_WIDTH } from "../layers/legendGlyphs"
import type { MapPalette, MapRole } from "../mapTheme"

export interface LegendSwatchProps {
  readonly shape: LegendShape
  readonly role: MapRole
  readonly palette: MapPalette
  readonly className: string | undefined
  readonly canvasClassName: string | undefined
}

export function LegendSwatch({
  shape,
  role,
  palette,
  className,
  canvasClassName,
}: LegendSwatchProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d") ?? null
    if (canvas === null || context === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(SWATCH_WIDTH * ratio)
    canvas.height = Math.round(SWATCH_HEIGHT * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawLegendGlyph(context, shape, role, palette)
  }, [shape, role, palette])
  return (
    <span className={className} aria-hidden="true">
      <canvas ref={canvasRef} className={canvasClassName} />
    </span>
  )
}
