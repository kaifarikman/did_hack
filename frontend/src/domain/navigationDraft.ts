import type { MapData, NavigationTarget, Point } from "./contract"
import { cellAtWorld } from "./geometry"

export interface NavigationDraft {
  xText: string
  yText: string

  mapId: string | null
}

export const EMPTY_DRAFT: NavigationDraft = { xText: "", yText: "", mapId: null }

const COORDINATE_DIGITS = 3

export function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(COORDINATE_DIGITS)))
}

export function parseCoordinate(text: string): number | null {
  const normalized = text.trim().replace(",", ".")
  if (normalized === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

export function draftFromPoint(point: Point, mapId: string | null): NavigationDraft {
  return {
    xText: formatCoordinate(point.position_x_m),
    yText: formatCoordinate(point.position_y_m),
    mapId,
  }
}

export type DraftProblem =
  | "empty"
  | "invalid_number"
  | "no_map"
  | "map_mismatch"
  | "outside_map"
  | "map_changed"

export interface DraftEvaluation {
  point: Point | null

  target: NavigationTarget | null
  problem: DraftProblem | null

  warning: "occupied" | "unknown" | null
}

export function evaluateDraft(
  draft: NavigationDraft,
  map: MapData | null,
  mapMismatch: boolean,
): DraftEvaluation {
  const blocked = (problem: DraftProblem, point: Point | null = null): DraftEvaluation => ({
    point,
    target: null,
    problem,
    warning: null,
  })
  if (draft.xText.trim() === "" && draft.yText.trim() === "") return blocked("empty")
  const x = parseCoordinate(draft.xText)
  const y = parseCoordinate(draft.yText)
  if (x === null || y === null) return blocked("invalid_number")
  const point: Point = { position_x_m: x, position_y_m: y }
  if (map === null) return blocked("no_map", point)
  if (mapMismatch) return blocked("map_mismatch", point)
  const cell = cellAtWorld(map, point)
  if (cell === null) return blocked("outside_map", point)
  if (draft.mapId !== map.map_id) return blocked("map_changed", point)
  const warning = cell.value === 100 ? "occupied" : cell.value < 0 ? "unknown" : null
  return { point, target: { ...point, map_id: map.map_id }, problem: null, warning }
}
