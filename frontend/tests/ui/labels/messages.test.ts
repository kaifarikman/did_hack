import { describe, expect, it } from "vitest"
import { buildScript } from "../../../src/adapters/fixture/catalog"
import type { MissionSnapshot, TerrainEstimate } from "../../../src/domain/contract"
import {
  describeSceneMessage,
  mapStateMessage,
  terrainLabelMessage,
} from "../../../src/ui/features/map/labels"
import {
  batteryMessage,
  batteryRatio,
  isBelowReturnReserve,
  outcomeOf,
  samplesMessage,
  signalText,
  simulationTimeText,
} from "../../../src/ui/features/mission/format"
import { STATUS_TONES } from "../../../src/ui/features/mission/labels"
import {
  hypothesisKindMessage,
  hypothesisStatusMessage,
  sensorLabels,
  terrainMessage,
} from "../../../src/ui/features/research/labels"
import { isTeamVisible } from "../../../src/ui/features/team/labels"
import { hasKey } from "./dictionaries"

const format = {
  number: (value: number, digits = 1) => value.toFixed(digits),
  unit: (value: number, unit: string, digits = 1) => `${value.toFixed(digits)} ${unit}`,
}

const estimate: TerrainEstimate = {
  region_id: "r",
  center: { position_x_m: 0, position_y_m: 0 },
  radius_m: 0.3,
  energy_per_m: 2,
  confidence: 0.5,
  std_energy_per_m: 0.25,
  regime: 1,
  last_measured_s: 1,
}

const frames = buildScript("hard_events").frames

describe("mission formatting takes formatters and returns messages", () => {
  it("formats battery, samples, time and signal", () => {
    expect(batteryMessage(12.34, 60, format)).toEqual({
      key: "mission:value.battery",
      params: { remaining: "12.3", initial: "60" },
    })
    expect(batteryMessage(null, 60, format).key).toBe("mission:value.batteryUnknown")
    expect(samplesMessage(1, null, format).key).toBe("mission:value.samplesOpen")
    expect(simulationTimeText(null, format)).toBeNull()
    expect(simulationTimeText(3, format)).toBe("3.0 second")
    expect(signalText(0.456, format)).toBe("0.46")
    expect(batteryRatio(90, 60)).toBe(1)
    expect(batteryRatio(null, 60)).toBeNull()
  })

  it("gives finished statuses distinct tones", () => {
    const tones = new Set([STATUS_TONES.completed, STATUS_TONES.stopped, STATUS_TONES.failed])
    expect(tones.size).toBe(3)
  })

  it("detects the return reserve and finished outcomes", () => {
    expect(frames.some((frame: MissionSnapshot) => isBelowReturnReserve(frame))).toBe(true)
    expect(isBelowReturnReserve(frames[0] as MissionSnapshot)).toBe(false)
    expect([
      outcomeOf("completed"),
      outcomeOf("stopped"),
      outcomeOf("failed"),
      outcomeOf("running"),
    ]).toEqual(["success", "interrupted", "failure", null])
  })
})

describe("research and map messages", () => {
  it("maps known and unknown hypothesis values", () => {
    expect(hypothesisStatusMessage("refuted").key).toBe("research:hypothesis.refuted")
    expect(hypothesisStatusMessage("weird")).toEqual({
      key: "research:hypothesis.unknown",
      params: { status: "weird" },
    })
    expect(hypothesisKindMessage("terrain_change").key).toBe(
      "research:hypothesisKind.terrainChange",
    )
    expect(sensorLabels("degraded", "dropout")).toEqual({
      state: "research:sensor.degraded",
      fault: "research:fault.dropout",
      tone: "critical",
    })
    expect(terrainMessage(estimate, format).params).toEqual({ energy: "2.0", spread: "0.3" })
  })

  it("chooses the terrain label variant and existing keys", () => {
    const variants = [
      terrainLabelMessage(estimate, format),
      terrainLabelMessage({ ...estimate, regime: 0 }, format),
      terrainLabelMessage({ ...estimate, std_energy_per_m: null }, format),
      terrainLabelMessage({ ...estimate, regime: 0, std_energy_per_m: null }, format),
    ]
    expect(new Set(variants.map((item) => item.key)).size).toBe(4)
    for (const item of variants) expect(hasKey("en", item.key)).toBe(true)
  })

  it("describes the map state", () => {
    const snapshot = frames[5] ?? null
    expect(mapStateMessage({ map: null, snapshot, mapError: null, mismatch: false })?.key).toBe(
      "map:state.loading",
    )
    expect(mapStateMessage({ map: null, snapshot, mapError: "x", mismatch: false })?.key).toBe(
      "map:state.missing",
    )
    expect(describeSceneMessage(snapshot, false, format).key).toBe("map:describe.unavailable")
    expect(describeSceneMessage(frames[0] ?? null, true, format).key).toBe(
      "map:describe.noRobot",
    )
    expect(isTeamVisible(null)).toBe(false)
  })
})
