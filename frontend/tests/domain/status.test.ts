import { describe, expect, it } from "vitest"
import type { MapData, MissionSnapshot, RunStatus } from "@/domain/contract"
import {
  isActiveStatus,
  isFinishedStatus,
  isMapMismatch,
  isStartableStatus,
  outcomeKind,
} from "@/domain/status"

const ALL: readonly RunStatus[] = [
  "idle",
  "starting",
  "running",
  "returning",
  "stopping",
  "completed",
  "stopped",
  "failed",
]

describe("run status rules", () => {
  it("splits statuses into active, finished and idle", () => {
    expect(ALL.filter(isActiveStatus)).toEqual(["starting", "running", "returning", "stopping"])
    expect(ALL.filter(isFinishedStatus)).toEqual(["completed", "stopped", "failed"])
    expect(ALL.filter(isStartableStatus)).toEqual(["idle", "completed", "stopped", "failed"])
  })

  it("maps only terminal statuses to an outcome", () => {
    expect(ALL.map(outcomeKind)).toEqual([
      "none",
      "none",
      "none",
      "none",
      "none",
      "success",
      "interrupted",
      "failure",
    ])
  })

  it("detects a map that belongs to another run", () => {
    const snapshot = { map_id: "a" } as MissionSnapshot
    expect(isMapMismatch(null, null)).toBe(false)
    expect(isMapMismatch({ map_id: null } as MissionSnapshot, null)).toBe(false)
    expect(isMapMismatch(snapshot, null)).toBe(true)
    expect(isMapMismatch(snapshot, { map_id: "b" } as MapData)).toBe(true)
    expect(isMapMismatch(snapshot, { map_id: "a" } as MapData)).toBe(false)
  })
})
