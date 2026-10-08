import { describe, expect, it } from "vitest"
import type { MapData } from "../../src/domain/contract"
import { knownCellRange } from "../../src/domain/geometry"

const WALL = 100
const FREE = 0
const UNKNOWN = -1

function mapOf(width: number, height: number, cells: number[]): MapData {
  return {
    map_id: "map",
    resolution_m: 0.05,
    width,
    height,
    origin: { position_x_m: 0, position_y_m: 0, heading_rad: 0 },
    cells,
  }
}

function grid(width: number, height: number, pick: (column: number, row: number) => number) {
  return Array.from({ length: width * height }, (_, index) =>
    pick(index % width, Math.floor(index / width)),
  )
}

describe("known cell range", () => {
  it("frames free cells with a two cell margin and ignores thick walls", () => {
    const cells = grid(20, 20, (column, row) =>
      column >= 8 && column <= 11 && row >= 8 && row <= 11 ? FREE : WALL,
    )
    expect(knownCellRange(mapOf(20, 20, cells))).toEqual({
      minColumn: 6,
      maxColumn: 14,
      minRow: 6,
      maxRow: 14,
    })
  })

  it("falls back to known cells, then to the whole grid", () => {
    const walls = grid(10, 10, (column, row) => (column === 5 && row === 5 ? WALL : UNKNOWN))
    expect(knownCellRange(mapOf(10, 10, walls))).toEqual({
      minColumn: 3,
      maxColumn: 8,
      minRow: 3,
      maxRow: 8,
    })
    const blank = grid(10, 10, () => UNKNOWN)
    expect(knownCellRange(mapOf(10, 10, blank))).toEqual({
      minColumn: 0,
      maxColumn: 10,
      minRow: 0,
      maxRow: 10,
    })
  })
})
