import type { FixtureScenarioName } from "../../src/adapters/fixture/catalog"
import { FixtureMissionGateway } from "../../src/adapters/fixture/fixtureGateway"
import { FINISHED_STATUSES, type MissionSnapshot } from "../../src/domain/contract"

export const instantWait = (): Promise<void> => Promise.resolve()

export function isFinished(snapshot: MissionSnapshot): boolean {
  return FINISHED_STATUSES.includes(snapshot.status)
}

export async function playUntilFinished(
  gateway: FixtureMissionGateway,
  limit = 200,
): Promise<{ frames: MissionSnapshot[]; failures: number }> {
  const frames: MissionSnapshot[] = []
  let failures = 0
  for (let step = 0; step < limit; step += 1) {
    try {
      const snapshot = await gateway.getState()
      frames.push(snapshot)
      if (isFinished(snapshot)) break
    } catch {
      failures += 1
    }
  }
  return { frames, failures }
}

export async function startScenario(name: FixtureScenarioName) {
  const gateway = new FixtureMissionGateway({ wait: instantWait })
  gateway.setScenario(name)
  await gateway.getHealth()
  const first = await gateway.startRun({ request_id: "r1", scenario: "easy", seed: 42 })
  return { gateway, first, runId: first.run_id ?? "" }
}

export function lastOf(frames: readonly MissionSnapshot[]): MissionSnapshot {
  const last = frames[frames.length - 1]
  if (last === undefined) throw new Error("no frames")
  return last
}
