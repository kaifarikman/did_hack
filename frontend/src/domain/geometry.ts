import type { MapData, MapOrigin, Point } from "./contract"

export interface Viewport {
  width: number
  height: number
}

export interface ScreenPoint {
  x: number
  y: number
}

export interface AffineMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface WorldBounds {
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

export function localToWorld(origin: MapOrigin, localX: number, localY: number): Point {
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

export function mapWorldBounds(map: MapData): WorldBounds {
  const widthM = map.width * map.resolution_m
  const heightM = map.height * map.resolution_m
  const corners = [
    localToWorld(map.origin, 0, 0),
    localToWorld(map.origin, widthM, 0),
    localToWorld(map.origin, 0, heightM),
    localToWorld(map.origin, widthM, heightM),
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
