import { describe, expect, it } from "vitest"
import {
  parseHealth,
  parseJournalPage,
  parseMap,
  parseSnapshot,
} from "../../src/domain/validation"
import { ALL_SCRIPTS } from "./scenarioData"

function roundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe.each(ALL_SCRIPTS)("fixture scenario $name", ({ script }) => {
  it("has frames that survive parseSnapshot unchanged", () => {
    expect(script.frames.length).toBeGreaterThan(0)
    for (const frame of [script.idle, ...script.frames]) {
      expect(parseSnapshot(roundTrip(frame))).toEqual(frame)
    }
  })

  it("has maps that survive parseMap unchanged", () => {
    for (const revision of script.maps) {
      if (revision.map !== null) expect(parseMap(roundTrip(revision.map))).toEqual(revision.map)
    }
  })

  it("has a journal that survives parseJournalPage", () => {
    const entries = script.journal.map((item, index) => ({
      ...item.entry,
      sequence: index + 1,
    }))
    const page = { run_id: "check", entries, next_sequence: entries.length, has_more: false }
    expect(parseJournalPage(roundTrip(page)).entries).toEqual(entries)
  })

  it("orders the journal by frame and keeps it inside the run", () => {
    const frames = script.journal.map((item) => item.atFrame)
    expect(frames).toEqual([...frames].sort((first, second) => first - second))
    expect(Math.max(...frames)).toBeLessThan(script.frames.length)
  })

  it("has a health timeline that survives parseHealth", () => {
    expect(script.health.length).toBeGreaterThan(0)
    for (const health of script.health) expect(parseHealth(roundTrip(health))).toEqual(health)
  })

  it("ends in a finished status", () => {
    const last = script.frames[script.frames.length - 1]
    expect(["completed", "stopped", "failed"]).toContain(last?.status)
  })

  it("keeps battery non-negative and team robots consistent", () => {
    for (const frame of script.frames) {
      expect(frame.battery_remaining ?? 0).toBeGreaterThanOrEqual(0)
      if (frame.team !== null)
        expect(frame.team.robots[0]?.robot_pose).toEqual(frame.robot_pose)
    }
  })
})
