import type { MapData } from "@/domain/contract"
import { createViewTransform, type Viewport, type ViewTransform } from "@/domain/geometry"
import { MapMotion } from "./animation/motion"
import type { LayerFrame, MapLabelText } from "./layers/frame"
import { drawGrid } from "./layers/grid"
import { drawHazards } from "./layers/hazards"
import { LabelSink } from "./layers/labels"
import { drawBase, drawGoal, drawPlanSteps, placeMarks } from "./layers/markers"
import { drawNavigation } from "./layers/navigation"
import { drawPaths } from "./layers/paths"
import { drawRobots } from "./layers/robots"
import { drawSamples } from "./layers/samples"
import { drawTerrain } from "./layers/terrain"
import type { MapPalette, MapTimings } from "./mapTheme"
import { EMPTY_SCENE, type MapScene } from "./scene"

export interface MapTheme {
  readonly palette: MapPalette
  readonly timings: MapTimings
  readonly font: string
  readonly stepFont: string
}

export class MapRenderer {
  private readonly motion: MapMotion
  private readonly labels = new LabelSink()
  private theme: MapTheme
  private text: MapLabelText
  private map: MapData | null = null
  private scene: MapScene = EMPTY_SCENE
  private viewport: Viewport = { width: 0, height: 0 }
  private transform: ViewTransform | null = null

  constructor(
    private readonly context: CanvasRenderingContext2D,
    theme: MapTheme,
    text: MapLabelText,
  ) {
    this.theme = theme
    this.text = text
    this.motion = new MapMotion(theme.timings)
  }

  setTheme(theme: MapTheme): void {
    this.theme = theme
    this.motion.setTimings(theme.timings)
  }

  setText(text: MapLabelText): void {
    this.text = text
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport
    this.transform = null
  }

  setMap(map: MapData | null): void {
    if (map === this.map) return
    this.map = map
    this.transform = null
  }

  setScene(scene: MapScene, now: number): void {
    this.scene = scene
    this.motion.update(scene, now)
  }

  render(now: number): boolean {
    const { context, viewport } = this
    context.clearRect(0, 0, viewport.width, viewport.height)
    const map = this.map
    if (map === null || viewport.width === 0 || viewport.height === 0) return false
    this.transform ??= createViewTransform(map, viewport)
    const animating = this.motion.advance(now)
    const frame: LayerFrame = {
      context,
      transform: this.transform,
      palette: this.theme.palette,
      motion: this.motion,
      scene: this.scene,
      labels: this.labels,
      text: this.text,
      now,
      easing: this.theme.timings.easing,
    }
    drawGrid(context, map, this.transform, this.theme.palette)
    this.labels.begin(context, this.theme.font)
    const marks = placeMarks(frame)
    drawTerrain(frame)
    drawHazards(frame)
    drawPaths(frame)
    drawBase(frame)
    drawSamples(frame)
    drawPlanSteps(frame, this.theme.stepFont, marks)
    this.labels.flush(context, this.theme.palette.css.labelHalo)
    drawGoal(frame)
    drawNavigation(frame)
    drawRobots(frame)
    return animating
  }
}
