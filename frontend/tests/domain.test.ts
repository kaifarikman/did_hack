import { describe, expect, it } from "vitest"
import type { MapData } from "../src/domain/contract"
import {
  cellCenterWorld,
  createViewTransform,
  localToScreenMatrix,
  screenToWorld,
  worldToScreen,
} from "../src/domain/geometry"
import {
  buildJournalExport,
  filterJournal,
  listHypothesisIds,
  mergeJournalEntries,
} from "../src/domain/journal"
import { ContractError, parseMap, parseSnapshot } from "../src/domain/validation"
import { entry, exampleMap, idle, running } from "./support"

const rotatedMap: MapData = {
  map_id: "asym",
  resolution_m: 0.5,
  width: 4,
  height: 2,
  origin: { position_x_m: 10, position_y_m: -3, heading_rad: Math.PI / 2 },
  cells: [0, 0, 0, 0, 0, 0, 100, -1],
}

describe("map geometry", () => {
  it("places a cell centre using resolution, rotation and origin offset", () => {
    const center = cellCenterWorld(rotatedMap, 3, 1)
    expect(center.position_x_m).toBeCloseTo(9.25)
    expect(center.position_y_m).toBeCloseTo(-1.25)
  })

  it("without rotation cell (0,0) is half a resolution away from origin", () => {
    const map = exampleMap()
    const center = cellCenterWorld(map, 0, 0)
    expect(center.position_x_m).toBeCloseTo(-2.5 + 0.125)
    expect(center.position_y_m).toBeCloseTo(-1 + 0.125)
  })

  it("flips the screen Y axis: larger world Y is higher on screen", () => {
    const transform = createViewTransform(exampleMap(), { width: 400, height: 300 })
    const low = worldToScreen(transform, { position_x_m: -1, position_y_m: -0.5 })
    const high = worldToScreen(transform, { position_x_m: -1, position_y_m: 0.5 })
    expect(high.y).toBeLessThan(low.y)
  })

  it("matches the cell matrix with worldToScreen for a rotated map", () => {
    const transform = createViewTransform(rotatedMap, { width: 500, height: 320 }, 10)
    const matrix = localToScreenMatrix(transform, rotatedMap.origin)
    const localX = (3 + 0.5) * rotatedMap.resolution_m
    const localY = (1 + 0.5) * rotatedMap.resolution_m
    const viaMatrix = {
      x: matrix.a * localX + matrix.c * localY + matrix.e,
      y: matrix.b * localX + matrix.d * localY + matrix.f,
    }
    const viaWorld = worldToScreen(transform, cellCenterWorld(rotatedMap, 3, 1))
    expect(viaMatrix.x).toBeCloseTo(viaWorld.x)
    expect(viaMatrix.y).toBeCloseTo(viaWorld.y)
  })

  it("fits the map into the viewport and inverts the transform exactly", () => {
    const viewport = { width: 300, height: 500 }
    const transform = createViewTransform(rotatedMap, viewport, 12)
    for (const [column, row] of [
      [0, 0],
      [3, 1],
      [0, 1],
      [3, 0],
    ] as const) {
      const screen = worldToScreen(transform, cellCenterWorld(rotatedMap, column, row))
      expect(screen.x).toBeGreaterThanOrEqual(12)
      expect(screen.x).toBeLessThanOrEqual(viewport.width - 12)
      expect(screen.y).toBeGreaterThanOrEqual(12)
      expect(screen.y).toBeLessThanOrEqual(viewport.height - 12)
    }
    const point = { position_x_m: 9.4, position_y_m: -2.2 }
    const back = screenToWorld(transform, worldToScreen(transform, point))
    expect(back.position_x_m).toBeCloseTo(point.position_x_m)
    expect(back.position_y_m).toBeCloseTo(point.position_y_m)
  })
})

describe("contract validation", () => {
  it("accepts shared examples and ignores unknown fields", () => {
    expect(parseSnapshot({ ...structuredClone(running()), extra: 1 }).status).toBe("running")
    expect(parseMap(exampleMap()).cells).toHaveLength(96)
  })

  it("keeps null for missing measurements", () => {
    const snapshot = parseSnapshot(idle())
    expect(snapshot.robot_pose).toBeNull()
    expect(snapshot.battery_remaining).toBeNull()
  })

  it.each([
    ["unknown status", (raw: Record<string, unknown>) => ({ ...raw, status: "flying" })],
    ["negative battery", (raw: Record<string, unknown>) => ({ ...raw, battery_remaining: -1 })],
    ["signal above 1", (raw: Record<string, unknown>) => ({ ...raw, sample_signal: 1.5 })],
    [
      "missing required field",
      (raw: Record<string, unknown>) => ({ ...raw, revision: undefined }),
    ],
    [
      "non-finite number",
      (raw: Record<string, unknown>) => ({ ...raw, simulation_time_s: Number.NaN }),
    ],
    [
      "foreign schema version",
      (raw: Record<string, unknown>) => ({ ...raw, schema_version: "2.0" }),
    ],
  ])("rejects a snapshot: %s", (_name, mutate) => {
    const raw = mutate(structuredClone(running()) as unknown as Record<string, unknown>)
    expect(() => parseSnapshot(raw)).toThrow(ContractError)
  })

  it("names the field in the error message", () => {
    expect(() => parseSnapshot({ ...running(), robot_pose: { position_x_m: "1" } })).toThrow(
      /robot_pose\.position_x_m/,
    )
  })

  it("rejects a map with a wrong cell count", () => {
    expect(() => parseMap({ ...exampleMap(), cells: [0, 0] })).toThrow(/cells/)
  })
})

describe("journal", () => {
  it("merges without duplicates and sorts", () => {
    const merged = mergeJournalEntries(
      [entry(1), entry(3)],
      [entry(2), entry(3, { title: "duplicate" })],
    )
    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3])
    expect(merged[2]?.title).toBe("Entry 3")
  })

  it("filters by kind", () => {
    const entries = [entry(1, { kind: "error" }), entry(2), entry(3, { kind: "error" })]
    expect(filterJournal(entries, "error").map((item) => item.sequence)).toEqual([1, 3])
    expect(filterJournal(entries, "all")).toHaveLength(3)
  })

  it("lists hypothesis ids once in order of appearance", () => {
    const entries = [
      entry(1, { hypothesis_id: "h2" }),
      entry(2, { hypothesis_id: "h1" }),
      entry(3),
      entry(4, { hypothesis_id: "h2" }),
    ]
    expect(listHypothesisIds(entries)).toEqual(["h2", "h1"])
  })

  it("keeps run_id, the boundary and every entry in the export", () => {
    const result = buildJournalExport("r1", [entry(2), entry(1)], 2)
    expect(result).toMatchObject({ run_id: "r1", last_sequence: 2, entry_count: 2 })
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2])
  })
})
