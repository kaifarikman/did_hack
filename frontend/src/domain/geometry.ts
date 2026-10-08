import type { MapData, MapOrigin, Point } from "./contract";

export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Матрица canvas: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  bounds: WorldBounds;
}

export function localToWorld(origin: MapOrigin, localX: number, localY: number): Point {
  const cos = Math.cos(origin.heading_rad);
  const sin = Math.sin(origin.heading_rad);
  return {
    position_x_m: origin.position_x_m + cos * localX - sin * localY,
    position_y_m: origin.position_y_m + sin * localX + cos * localY,
  };
}

/** Мировой центр клетки: центр в локальных координатах, поворот на heading origin, сдвиг на origin. */
export function cellCenterWorld(map: MapData, column: number, row: number): Point {
  return localToWorld(map.origin, (column + 0.5) * map.resolution_m, (row + 0.5) * map.resolution_m);
}

export function mapWorldBounds(map: MapData): WorldBounds {
  const widthM = map.width * map.resolution_m;
  const heightM = map.height * map.resolution_m;
  const corners = [
    localToWorld(map.origin, 0, 0),
    localToWorld(map.origin, widthM, 0),
    localToWorld(map.origin, 0, heightM),
    localToWorld(map.origin, widthM, heightM),
  ];
  const xs = corners.map((corner) => corner.position_x_m);
  const ys = corners.map((corner) => corner.position_y_m);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Вписывает карту в область просмотра с сохранением пропорций; экранная ось Y направлена вниз. */
export function createViewTransform(map: MapData, viewport: Viewport, padding = 12): ViewTransform {
  const bounds = mapWorldBounds(map);
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const availableWidth = Math.max(viewport.width - 2 * padding, 1);
  const availableHeight = Math.max(viewport.height - 2 * padding, 1);
  const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight);
  return {
    scale,
    offsetX: (viewport.width - worldWidth * scale) / 2,
    offsetY: (viewport.height - worldHeight * scale) / 2,
    bounds,
  };
}

export function worldToScreen(transform: ViewTransform, point: Point): ScreenPoint {
  return {
    x: transform.offsetX + (point.position_x_m - transform.bounds.minX) * transform.scale,
    y: transform.offsetY + (transform.bounds.maxY - point.position_y_m) * transform.scale,
  };
}

export function screenToWorld(transform: ViewTransform, screen: ScreenPoint): Point {
  return {
    position_x_m: transform.bounds.minX + (screen.x - transform.offsetX) / transform.scale,
    position_y_m: transform.bounds.maxY - (screen.y - transform.offsetY) / transform.scale,
  };
}

/** Матрица перевода локальных метров карты (до поворота) в экранные пиксели. */
export function localToScreenMatrix(transform: ViewTransform, origin: MapOrigin): AffineMatrix {
  const cos = Math.cos(origin.heading_rad);
  const sin = Math.sin(origin.heading_rad);
  const { scale, bounds } = transform;
  return {
    a: scale * cos,
    b: -scale * sin,
    c: -scale * sin,
    d: -scale * cos,
    e: transform.offsetX + scale * (origin.position_x_m - bounds.minX),
    f: transform.offsetY + scale * (bounds.maxY - origin.position_y_m),
  };
}

/** Угол направления робота на экране: ось Y экрана перевёрнута. */
export function headingToScreenAngle(headingRad: number): number {
  return -headingRad;
}

/** Обратное преобразование: мировая точка → локальные метры карты (до поворота origin). */
export function worldToLocal(origin: MapOrigin, point: Point): { x: number; y: number } {
  const cos = Math.cos(origin.heading_rad);
  const sin = Math.sin(origin.heading_rad);
  const deltaX = point.position_x_m - origin.position_x_m;
  const deltaY = point.position_y_m - origin.position_y_m;
  return { x: cos * deltaX + sin * deltaY, y: -sin * deltaX + cos * deltaY };
}

export interface CellLookup {
  column: number;
  row: number;
  /** Значение клетки occupancy grid: 0 свободно, 100 занято, -1 неизвестно. */
  value: number;
}

/** Клетка карты под мировой точкой; null, если точка вне карты. Правая/верхняя граница не входит. */
export function cellAtWorld(map: MapData, point: Point): CellLookup | null {
  const local = worldToLocal(map.origin, point);
  const column = Math.floor(local.x / map.resolution_m);
  const row = Math.floor(local.y / map.resolution_m);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return null;
  if (column < 0 || row < 0 || column >= map.width || row >= map.height) return null;
  return { column, row, value: map.cells[row * map.width + column] ?? -1 };
}

/**
 * Координата клика на canvas → мировая точка карты.
 * Размер canvas в CSS-пикселях берётся из viewport преобразования, поэтому devicePixelRatio не влияет;
 * разница между отрисованным и логическим размером (масштаб страницы) учитывается через rect.
 */
export function canvasClickToWorld(
  transform: ViewTransform,
  viewport: Viewport,
  rect: { left: number; top: number; width: number; height: number },
  client: { x: number; y: number },
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const screen = {
    x: ((client.x - rect.left) * viewport.width) / rect.width,
    y: ((client.y - rect.top) * viewport.height) / rect.height,
  };
  if (screen.x < 0 || screen.y < 0 || screen.x > viewport.width || screen.y > viewport.height) return null;
  return screenToWorld(transform, screen);
}
