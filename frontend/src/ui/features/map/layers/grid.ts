import type { MapData } from "@/domain/contract"
import { localToScreenMatrix, type ViewTransform } from "@/domain/geometry"
import type { Rgba } from "../color"
import type { MapPalette } from "../mapTheme"

interface GridRaster {
  palette: MapPalette
  canvas: HTMLCanvasElement
}

const OBSTACLE_CELL = 100
const FREE_CELL = 0
const OPAQUE = 255
const rasters = new WeakMap<MapData, GridRaster>()

export function cellRole(value: number): "obstacle" | "free" | "unknown" {
  if (value === OBSTACLE_CELL) return "obstacle"
  if (value === FREE_CELL) return "free"
  return "unknown"
}

export function fillCells(
  target: Uint8ClampedArray,
  cells: readonly number[],
  palette: MapPalette,
): void {
  const colors: Record<"obstacle" | "free" | "unknown", Rgba> = {
    obstacle: palette.rgba.obstacle,
    free: palette.rgba.free,
    unknown: palette.rgba.unknown,
  }
  cells.forEach((value, index) => {
    const [red, green, blue, alpha] = colors[cellRole(value)]
    const offset = index * 4
    target[offset] = red
    target[offset + 1] = green
    target[offset + 2] = blue
    target[offset + 3] = Math.round(alpha * OPAQUE)
  })
}

function raster(map: MapData, palette: MapPalette): HTMLCanvasElement {
  const cached = rasters.get(map)
  if (cached !== undefined && cached.palette === palette) return cached.canvas
  const canvas = document.createElement("canvas")
  canvas.width = map.width
  canvas.height = map.height
  const context = canvas.getContext("2d")
  if (context !== null) {
    const image = context.createImageData(map.width, map.height)
    fillCells(image.data, map.cells, palette)
    context.putImageData(image, 0, 0)
  }
  rasters.set(map, { palette, canvas })
  return canvas
}

export function drawGrid(
  context: CanvasRenderingContext2D,
  map: MapData,
  transform: ViewTransform,
  palette: MapPalette,
): void {
  const matrix = localToScreenMatrix(transform, map.origin)
  const cell = map.resolution_m
  context.save()
  context.transform(
    matrix.a * cell,
    matrix.b * cell,
    matrix.c * cell,
    matrix.d * cell,
    matrix.e,
    matrix.f,
  )
  context.imageSmoothingEnabled = false
  context.drawImage(raster(map, palette), 0, 0, map.width, map.height)
  context.restore()
}
