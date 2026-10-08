import type { MapData, Point } from "../../domain/contract"
import { cellAtWorld, cellCenterWorld } from "../../domain/geometry"

function key(column: number, row: number): string {
  return `${column},${row}`
}

export function planGridRoute(map: MapData, from: Point, to: Point): Point[] | null {
  const start = cellAtWorld(map, from)
  const goal = cellAtWorld(map, to)
  if (start === null || goal === null || start.value !== 0 || goal.value !== 0) return null
  const previous = new Map<string, string | null>([[key(start.column, start.row), null]])
  const queue: Array<[number, number]> = [[start.column, start.row]]
  for (let head = 0; head < queue.length; head += 1) {
    const [column, row] = queue[head] as [number, number]
    if (column === goal.column && row === goal.row) break
    for (const [nextColumn, nextRow] of freeNeighbors(map, column, row)) {
      const nextKey = key(nextColumn, nextRow)
      if (previous.has(nextKey)) continue
      previous.set(nextKey, key(column, row))
      queue.push([nextColumn, nextRow])
    }
  }
  if (!previous.has(key(goal.column, goal.row))) return null
  const cells: string[] = []
  for (
    let cursor: string | null | undefined = key(goal.column, goal.row);
    cursor;
    cursor = previous.get(cursor)
  ) {
    cells.push(cursor)
  }
  cells.reverse()
  const centers = cells.map((cell) => {
    const [column, row] = cell.split(",").map(Number) as [number, number]
    return cellCenterWorld(map, column, row)
  })
  return [from, ...centers.slice(1, -1), to]
}

function freeNeighbors(map: MapData, column: number, row: number): Array<[number, number]> {
  const candidates: Array<[number, number]> = [
    [column + 1, row],
    [column - 1, row],
    [column, row + 1],
    [column, row - 1],
  ]
  return candidates.filter(
    ([nextColumn, nextRow]) =>
      nextColumn >= 0 &&
      nextRow >= 0 &&
      nextColumn < map.width &&
      nextRow < map.height &&
      map.cells[nextRow * map.width + nextColumn] === 0,
  )
}
