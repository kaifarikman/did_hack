import { useEffect, useMemo, useRef, useState } from "react"
import type { MapData, MissionSnapshot } from "@/domain/contract"
import { useReducedMotion } from "@/ui/shared/motion"
import { browserFrames, createFrameLoop, type FrameLoop } from "../animation/loop"
import type { MapLabelText } from "../layers/frame"
import { readMapFont, readMapPalette, readMapStepFont, readMapTimings } from "../mapTheme"
import { MapRenderer, type MapTheme } from "../renderer"
import { buildScene } from "../scene"
import styles from "./styles.module.css"

export interface MapCanvasProps {
  readonly map: MapData | null
  readonly snapshot: MissionSnapshot | null
  readonly text: MapLabelText
  readonly label: string
}

interface CanvasSize {
  width: number
  height: number
}

type ZoomAware = HTMLCanvasElement & { readonly currentCSSZoom?: number }

function cssZoomOf(canvas: HTMLCanvasElement): number {
  return (canvas as ZoomAware).currentCSSZoom ?? 1
}

function usePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const update = () => setRatio(window.devicePixelRatio || 1)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [ratio])
  return ratio
}

export function MapCanvas({ map, snapshot, text, label }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MapRenderer | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const pixelRatio = usePixelRatio()
  const reducedMotion = useReducedMotion()
  const theme = useMemo<MapTheme>(
    () => ({
      palette: readMapPalette(),
      timings: readMapTimings(reducedMotion),
      font: readMapFont(),
      stepFont: readMapStepFont(),
    }),
    [reducedMotion],
  )
  const scene = useMemo(() => buildScene(snapshot), [snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the renderer is created once, later effects push theme and text
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d") ?? null
    if (context === null) return
    const renderer = new MapRenderer(context, theme, text)
    const loop = createFrameLoop((now) => renderer.render(now), browserFrames)
    rendererRef.current = renderer
    loopRef.current = loop
    return () => {
      loop.stop()
      rendererRef.current = null
      loopRef.current = null
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(container)
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) loopRef.current?.wake()
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.setTheme(theme)
    rendererRef.current?.setText(text)
    loopRef.current?.wake()
  }, [theme, text])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d") ?? null
    if (canvas === null || context === null) return
    const ratio = pixelRatio * cssZoomOf(canvas)
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    rendererRef.current?.setViewport(size)
    loopRef.current?.wake()
  }, [size, pixelRatio])

  useEffect(() => {
    rendererRef.current?.setMap(map)
    loopRef.current?.wake()
  }, [map])

  useEffect(() => {
    rendererRef.current?.setScene(scene, performance.now())
    loopRef.current?.wake()
  }, [scene])

  return (
    <div ref={containerRef} className={styles.surface}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={label} />
    </div>
  )
}
