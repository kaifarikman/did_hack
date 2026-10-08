import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { FixtureMissionGateway } from "../../src/adapters/fixture/fixtureGateway"
import { SLAM_FIRST_MAP_AT } from "../../src/adapters/fixture/scenarios/slamBuilding"
import { EXPORT_PAGE_SIZE } from "../../src/application/exportJournal"
import { playUntilFinished, startScenario } from "./gatewayDriver"

describe("fixture gateway: journal and map", () => {
  it("numbers the journal continuously, paginates, and shows the final entry", async () => {
    const { gateway, runId } = await startScenario("success")
    await playUntilFinished(gateway)
    const all = await gateway.getJournalPage(runId, 0, 200)
    expect(all.entries.map((item) => item.sequence)).toEqual(
      all.entries.map((_item, index) => index + 1),
    )
    expect(all.entries.at(-1)?.kind).toBe("outcome")
    const firstPage = await gateway.getJournalPage(runId, 0, 3)
    expect(firstPage.has_more).toBe(true)
    const rest = await gateway.getJournalPage(runId, firstPage.next_sequence, 200)
    expect([...firstPage.entries, ...rest.entries]).toEqual(all.entries)
  })

  it("keeps the second hypothesis without a conclusion", async () => {
    const { gateway, runId } = await startScenario("success")
    await playUntilFinished(gateway)
    const page = await gateway.getJournalPage(runId, 0, 200)
    const second = page.entries.filter((item) => item.hypothesis_id === "fixture-hypothesis-2")
    expect(second.length).toBeGreaterThan(0)
    expect(second.every((item) => item.conclusion === null)).toBe(true)
  })

  it("journal_long pages over hundreds of entries and fails one export page", async () => {
    let waits = 0
    const gateway = new FixtureMissionGateway({
      wait: () => {
        waits += 1
        return Promise.resolve()
      },
    })
    gateway.setScenario("journal_long")
    const run = await gateway.startRun({ request_id: "r", scenario: "easy", seed: 1 })
    await playUntilFinished(gateway)
    const runId = run.run_id ?? ""
    const firstPage = await gateway.getJournalPage(runId, 0, EXPORT_PAGE_SIZE)
    expect(firstPage.has_more).toBe(true)
    await expect(
      gateway.getJournalPage(runId, firstPage.next_sequence, EXPORT_PAGE_SIZE),
    ).rejects.toMatchObject({ status: 503 })
    const retried = await gateway.getJournalPage(
      runId,
      firstPage.next_sequence,
      EXPORT_PAGE_SIZE,
    )
    expect(retried.entries.length).toBeGreaterThan(0)
    expect(waits).toBe(3)
  })

  it("slam_building has no map at first, then growing maps with a late revision", async () => {
    const { gateway } = await startScenario("slam_building")
    await expect(gateway.getMap()).rejects.toMatchObject({ status: 404 })
    const seen: string[] = []
    let mismatches = 0
    for (let step = 0; step < 60; step += 1) {
      const snapshot = await gateway.getState()
      expect(snapshot.map_mode).toBe("slam")
      if (step < SLAM_FIRST_MAP_AT) continue
      const map = await gateway.getMap()
      seen.push(map.map_id)
      if (map.map_id !== snapshot.map_id) mismatches += 1
    }
    const finalMap = await gateway.getMap()
    const unknownCells = finalMap.cells.filter((cell) => cell === -1).length
    expect(new Set(seen).size).toBeGreaterThan(3)
    expect(mismatches).toBeGreaterThan(0)
    expect(unknownCells).toBeLessThan(finalMap.cells.length)
  })
})

describe("shared contract example copies", () => {
  const shared = new URL("../../../context/mvp/examples/", import.meta.url)
  const local = new URL("../../src/adapters/fixture/examples/", import.meta.url)
  it.skipIf(!existsSync(shared))("match context/mvp/examples (npm run sync-examples)", () => {
    for (const name of [
      "state-idle.json",
      "state-running.json",
      "map.json",
      "journal.json",
      "error.json",
    ]) {
      const read = (base: URL) => JSON.parse(readFileSync(new URL(name, base), "utf8"))
      expect(read(local)).toEqual(read(shared))
    }
  })
})
