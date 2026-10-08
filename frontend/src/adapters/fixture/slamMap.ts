import type { MapData, Point } from "../../domain/contract"
import { cellCenterWorld } from "../../domain/geometry"
import { distance } from "./route"

const UNKNOWN_CELL = -1

export function slamMapId(revision: number): string {
  return `fixture-slam#r${revision}`
}

export function revealMap(
  truth: MapData,
  seen: readonly Point[],
  radiusM: number,
  revision: number,
): MapData {
  const cells = truth.cells.map((value, index) => {
    const column = index % truth.width
    const row = Math.floor(index / truth.width)
    const center = cellCenterWorld(truth, column, row)
    const visible = seen.some((place) => distance(place, center) <= radiusM)
    return visible ? value : UNKNOWN_CELL
  })
  return { ...truth, map_id: slamMapId(revision), cells }
}
