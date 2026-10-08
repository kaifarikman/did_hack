import { describe, expect, it } from "vitest"
import { buildScript, FIXTURE_SCENARIOS } from "@/adapters/fixture/catalog"
import { poseOnRoute, turnBetween } from "@/adapters/fixture/route"

const QUARTER_TURN = Math.PI / 2 + 0.01

function largestTurn(headings: readonly (number | null)[]): number {
  let largest = 0
  let previous: number | null = null
  for (const heading of headings) {
    if (heading !== null && previous !== null) {
      const delta = Math.abs(turnBetween(previous, heading, 1) - previous)
      largest = Math.max(largest, delta)
    }
    if (heading !== null) previous = heading
  }
  return largest
}

describe("fixture headings", () => {
  it.each(FIXTURE_SCENARIOS)("%s never spins a robot more than a quarter turn", (name) => {
    const frames = buildScript(name).frames
    expect(
      largestTurn(frames.map((frame) => frame.robot_pose?.heading_rad ?? null)),
    ).toBeLessThan(QUARTER_TURN)
    expect(
      largestTurn(
        frames.map((frame) => frame.team?.robots[1]?.robot_pose?.heading_rad ?? null),
      ),
    ).toBeLessThan(QUARTER_TURN)
  })

  it("keeps the previous heading on a zero-length segment", () => {
    const route = [
      { position_x_m: 0, position_y_m: 0 },
      { position_x_m: 0, position_y_m: 1 },
      { position_x_m: 0, position_y_m: 1 },
    ]
    expect(poseOnRoute(route, 2).heading_rad).toBeCloseTo(Math.PI / 2, 3)
    expect(poseOnRoute([{ position_x_m: 1, position_y_m: 1 }], 0, 1.2).heading_rad).toBe(1.2)
  })

  it("turns the short way", () => {
    expect(turnBetween(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6), 3)
    expect(turnBetween(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 3)
  })
})
