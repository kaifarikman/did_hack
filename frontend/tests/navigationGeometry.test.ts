import { describe, expect, it } from "vitest"
import type { MapData } from "../src/domain/contract"
import {
  canvasClickToWorld,
  cellAtWorld,
  createViewTransform,
  screenToWorld,
  worldToLocal,
  worldToScreen,
} from "../src/domain/geometry"
import {
  draftFromPoint,
  EMPTY_DRAFT,
  evaluateDraft,
  parseCoordinate,
} from "../src/domain/navigationDraft"
import { exampleMap } from "./support"

function mapWith(patch: Partial<MapData>): MapData {
  return { ...exampleMap(), ...patch }
}

describe("map click to world", () => {
  const map = exampleMap()

  it("canvas center and inverted Y axis", () => {
    const viewport = { width: 600, height: 400 }
    const transform = createViewTransform(map, viewport)
    const center = canvasClickToWorld(
      transform,
      viewport,
      { left: 0, top: 0, width: 600, height: 400 },
      { x: 300, y: 200 },
    )
    expect(center?.position_x_m).toBeCloseTo(-1.0, 6)
    expect(center?.position_y_m).toBeCloseTo(0, 6)
    const top = screenToWorld(transform, { x: 300, y: transform.offsetY })
    const bottom = screenToWorld(transform, {
      x: 300,
      y: transform.offsetY + 2 * transform.scale,
    })
    expect(top.position_y_m).toBeGreaterThan(bottom.position_y_m)
  })

  it("screen and world transforms are inverse", () => {
    const transform = createViewTransform(map, { width: 480, height: 360 })
    for (const point of [
      { position_x_m: -2.4, position_y_m: -0.9 },
      { position_x_m: -0.75, position_y_m: 0.3 },
      { position_x_m: 0.4, position_y_m: 0.95 },
    ]) {
      const back = screenToWorld(transform, worldToScreen(transform, point))
      expect(back.position_x_m).toBeCloseTo(point.position_x_m, 9)
      expect(back.position_y_m).toBeCloseTo(point.position_y_m, 9)
    }
  })

  it("resize preserves world coordinates", () => {
    const point = { position_x_m: -1.4, position_y_m: 0.2 }
    for (const viewport of [
      { width: 300, height: 300 },
      { width: 900, height: 450 },
      { width: 1400, height: 320 },
    ]) {
      const transform = createViewTransform(map, viewport)
      const screen = worldToScreen(transform, point)
      const world = canvasClickToWorld(
        transform,
        viewport,
        { left: 17, top: 33, width: viewport.width, height: viewport.height },
        { x: screen.x + 17, y: screen.y + 33 },
      )
      expect(world?.position_x_m).toBeCloseTo(point.position_x_m, 9)
      expect(world?.position_y_m).toBeCloseTo(point.position_y_m, 9)
    }
  })

  it("device pixel ratio and CSS zoom", () => {
    const viewport = { width: 600, height: 400 }
    const transform = createViewTransform(map, viewport)
    const point = { position_x_m: -0.5, position_y_m: -0.4 }
    const screen = worldToScreen(transform, point)

    const scaled = canvasClickToWorld(
      transform,
      viewport,
      { left: 10, top: 20, width: 300, height: 200 },
      { x: 10 + screen.x / 2, y: 20 + screen.y / 2 },
    )
    expect(scaled?.position_x_m).toBeCloseTo(point.position_x_m, 9)
    expect(scaled?.position_y_m).toBeCloseTo(point.position_y_m, 9)
  })

  it("click outside canvas or map", () => {
    const viewport = { width: 600, height: 200 }
    const transform = createViewTransform(map, viewport)
    const rect = { left: 0, top: 0, width: 600, height: 200 }
    expect(canvasClickToWorld(transform, viewport, rect, { x: -5, y: 10 })).toBeNull()
    const margin = canvasClickToWorld(transform, viewport, rect, { x: 5, y: 100 })
    expect(margin).not.toBeNull()
    expect(cellAtWorld(map, margin as NonNullable<typeof margin>)).toBeNull()
    expect(
      canvasClickToWorld(
        transform,
        viewport,
        { left: 0, top: 0, width: 0, height: 0 },
        { x: 1, y: 1 },
      ),
    ).toBeNull()
  })

  it("rotated map origin and cell lookup", () => {
    const rotated = mapWith({
      origin: { position_x_m: 1, position_y_m: 2, heading_rad: Math.PI / 2 },
    })

    const world = { position_x_m: 0.7, position_y_m: 2.6 }
    const local = worldToLocal(rotated.origin, world)
    expect(local.x).toBeCloseTo(0.6, 9)
    expect(local.y).toBeCloseTo(0.3, 9)
    expect(cellAtWorld(rotated, world)).toMatchObject({ column: 2, row: 1 })
  })

  it("cell bounds are half open", () => {
    expect(cellAtWorld(map, { position_x_m: -2.5, position_y_m: -1 })).toMatchObject({
      column: 0,
      row: 0,
    })
    expect(cellAtWorld(map, { position_x_m: 0.5, position_y_m: 0 })).toBeNull()
    expect(cellAtWorld(map, { position_x_m: -0.5, position_y_m: 1 })).toBeNull()
    expect(cellAtWorld(map, { position_x_m: Number.NaN, position_y_m: 0 })).toBeNull()
  })
})

describe("navigation draft", () => {
  const map = exampleMap()

  it("decimal comma and invalid numbers", () => {
    expect(parseCoordinate("-0,75")).toBe(-0.75)
    expect(parseCoordinate(" 1.5 ")).toBe(1.5)
    for (const bad of ["", "abc", "1e3", "Infinity", "NaN", "1..2", "--1", "0x10"])
      expect(parseCoordinate(bad)).toBeNull()
  })

  it("empty invalid outside stale and ready drafts", () => {
    expect(evaluateDraft(EMPTY_DRAFT, map, false).problem).toBe("empty")
    expect(
      evaluateDraft({ xText: "a", yText: "1", mapId: map.map_id }, map, false).problem,
    ).toBe("invalid_number")
    expect(
      evaluateDraft({ xText: "5", yText: "5", mapId: map.map_id }, map, false),
    ).toMatchObject({ problem: "outside_map", target: null })
    expect(
      evaluateDraft({ xText: "-1", yText: "0", mapId: "old-map" }, map, false).problem,
    ).toBe("map_changed")
    expect(
      evaluateDraft({ xText: "-1", yText: "0", mapId: map.map_id }, map, true).problem,
    ).toBe("map_mismatch")
    expect(
      evaluateDraft({ xText: "-1", yText: "0", mapId: map.map_id }, null, false).problem,
    ).toBe("no_map")
    const ready = evaluateDraft({ xText: "-0,75", yText: "0.5", mapId: map.map_id }, map, false)
    expect(ready.problem).toBeNull()
    expect(ready.target).toEqual({ position_x_m: -0.75, position_y_m: 0.5, map_id: map.map_id })
  })

  it("occupied cell warns but backend decides reachability", () => {
    const wall = evaluateDraft({ xText: "-2.4", yText: "0", mapId: map.map_id }, map, false)
    expect(wall.target).not.toBeNull()
    expect(wall.warning).toBe("occupied")
  })

  it("click records precision and map ID", () => {
    const draft = draftFromPoint(
      { position_x_m: -0.7500001, position_y_m: 0.30049 },
      map.map_id,
    )
    expect(draft).toEqual({ xText: "-0.75", yText: "0.3", mapId: map.map_id })
  })
})
