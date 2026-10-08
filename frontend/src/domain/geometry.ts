import type { MapData, MapOrigin, Point } from "./contract"

export interface Viewport {
  width: number
  height: number
}

interface ScreenPoint {
  x: number
  y: number
}

interface AffineMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ViewTransform {
  scale: number
  offsetX: number
  offsetY: number
  bounds: WorldBounds
}

function localToWorld(origin: MapOrigin, localX: number, localY: number): Point {
  const cos = Math.cos(origin.heading_rad)
  const sin = Math.sin(origin.heading_rad)
  return {
    position_x_m: origin.position_x_m + cos * localX - sin * localY,
    position_y_m: origin.position_y_m + sin * localX + cos * localY,
  }
}

export function cellCenterWorld(map: MapData, column: number, row: number): Point {
  return localToWorld(
    map.origin,
    (column + 0.5) * map.resolution_m,
    (row + 0.5) * map.resolution_m,
  )
}

const KNOWN_MARGIN_CELLS = 2

interface CellRange {
  readonly minColumn: number
  readonly maxColumn: number
  readonly minRow: number
  readonly maxRow: number
}

const FREE_CELL = 0

function cellRangeWhere(map: MapData, accept: (value: number) => boolean): CellRange | null {
  let minColumn = map.width
  let maxColumn = -1
  let minRow = map.height
  let maxRow = -1
  for (let index = 0; index < map.cells.length; index += 1) {
    if (!accept(map.cells[index] ?? -1)) continue
    const column = index % map.width
    const row = Math.floor(index / map.width)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
  }
  if (maxColumn < 0) return null
  return {
    minColumn: Math.max(minColumn - KNOWN_MARGIN_CELLS, 0),
    maxColumn: Math.min(maxColumn + 1 + KNOWN_MARGIN_CELLS, map.width),
    minRow: Math.max(minRow - KNOWN_MARGIN_CELLS, 0),
    maxRow: Math.min(maxRow + 1 + KNOWN_MARGIN_CELLS, map.height),
  }
}

export function knownCellRange(map: MapData): CellRange {
  return (
    cellRangeWhere(map, (value) => value === FREE_CELL) ??
    cellRangeWhere(map, (value) => value >= 0) ?? {
      minColumn: 0,
      maxColumn: map.width,
      minRow: 0,
      maxRow: map.height,
    }
  )
}

function mapWorldBounds(map: MapData): WorldBounds {
  const range = knownCellRange(map)
  const left = range.minColumn * map.resolution_m
  const right = range.maxColumn * map.resolution_m
  const bottom = range.minRow * map.resolution_m
  const top = range.maxRow * map.resolution_m
  const corners = [
    localToWorld(map.origin, left, bottom),
    localToWorld(map.origin, right, bottom),
    localToWorld(map.origin, left, top),
    localToWorld(map.origin, right, top),
  ]
  const xs = corners.map((corner) => corner.position_x_m)
  const ys = corners.map((corner) => corner.position_y_m)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

export function createViewTransform(
  map: MapData,
  viewport: Viewport,
  padding = 12,
): ViewTransform {
  const bounds = mapWorldBounds(map)
  const worldWidth = bounds.maxX - bounds.minX
  const worldHeight = bounds.maxY - bounds.minY
  const availableWidth = Math.max(viewport.width - 2 * padding, 1)
  const availableHeight = Math.max(viewport.height - 2 * padding, 1)
  const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight)
  return {
    scale,
    offsetX: (viewport.width - worldWidth * scale) / 2,
    offsetY: (viewport.height - worldHeight * scale) / 2,
    bounds,
  }
}

export function worldToScreen(transform: ViewTransform, point: Point): ScreenPoint {
  return {
    x: transform.offsetX + (point.position_x_m - transform.bounds.minX) * transform.scale,
    y: transform.offsetY + (transform.bounds.maxY - point.position_y_m) * transform.scale,
  }
}

export function screenToWorld(transform: ViewTransform, screen: ScreenPoint): Point {
  return {
    position_x_m: transform.bounds.minX + (screen.x - transform.offsetX) / transform.scale,
    position_y_m: transform.bounds.maxY - (screen.y - transform.offsetY) / transform.scale,
  }
}

export function localToScreenMatrix(transform: ViewTransform, origin: MapOrigin): AffineMatrix {
  const cos = Math.cos(origin.heading_rad)
  const sin = Math.sin(origin.heading_rad)
  const { scale, bounds } = transform
  return {
    a: scale * cos,
    b: -scale * sin,
    c: -scale * sin,
    d: -scale * cos,
    e: transform.offsetX + scale * (origin.position_x_m - bounds.minX),
    f: transform.offsetY + scale * (bounds.maxY - origin.position_y_m),
  }
}

export function headingToScreenAngle(headingRad: number): number {
  return -headingRad
}

export function worldToLocal(origin: MapOrigin, point: Point): { x: number; y: number } {
  const cos = Math.cos(origin.heading_rad)
  const sin = Math.sin(origin.heading_rad)
  const deltaX = point.position_x_m - origin.position_x_m
  const deltaY = point.position_y_m - origin.position_y_m
  return { x: cos * deltaX + sin * deltaY, y: -sin * deltaX + cos * deltaY }
}

export interface CellLookup {
  column: number
  row: number

  value: number
}

export function cellAtWorld(map: MapData, point: Point): CellLookup | null {
  const local = worldToLocal(map.origin, point)
  const column = Math.floor(local.x / map.resolution_m)
  const row = Math.floor(local.y / map.resolution_m)
  if (!Number.isFinite(column) || !Number.isFinite(row)) return null
  if (column < 0 || row < 0 || column >= map.width || row >= map.height) return null
  return { column, row, value: map.cells[row * map.width + column] ?? -1 }
}

export function canvasClickToWorld(
  transform: ViewTransform,
  viewport: Viewport,
  rect: { left: number; top: number; width: number; height: number },
  client: { x: number; y: number },
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const screen = {
    x: ((client.x - rect.left) * viewport.width) / rect.width,
    y: ((client.y - rect.top) * viewport.height) / rect.height,
  }
  if (screen.x < 0 || screen.y < 0 || screen.x > viewport.width || screen.y > viewport.height)
    return null
  return screenToWorld(transform, screen)
}
