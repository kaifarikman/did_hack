import { describe, expect, it } from "vitest"
import type { FixtureScenarioName } from "../../src/adapters/fixture/catalog"
import { FixtureMissionGateway } from "../../src/adapters/fixture/fixtureGateway"
import { MissionController } from "../../src/application/missionController"
import type {
  CommandPhase,
  ConnectionState,
  ExportPhase,
} from "../../src/application/viewState"
import { FakeScheduler } from "../support"

const TICK_MS = 500

interface Harness {
  controller: MissionController
  scheduler: FakeScheduler
  commands: CommandPhase[]
  connections: ConnectionState[]
  exports: ExportPhase[]
  tick(times?: number): Promise<void>
}

async function boot(name: FixtureScenarioName): Promise<Harness> {
  const scheduler = new FakeScheduler()
  const gateway = new FixtureMissionGateway({
    wait: (delayMs) => new Promise((resolve) => scheduler.setTimeout(resolve, delayMs)),
  })
  gateway.setScenario(name)
  let counter = 0
  const controller = new MissionController({
    gateway,
    scheduler,
    generateId: () => {
      counter += 1
      return `req-${counter}`
    },
  })
  const harness: Harness = {
    controller,
    scheduler,
    commands: [],
    connections: [],
    exports: [],
    tick: async (times = 1) => {
      for (let index = 0; index < times; index += 1) await scheduler.advance(TICK_MS)
    },
  }
  controller.subscribe(() => {
    const view = controller.getView()
    harness.commands.push(view.command.phase)
    harness.connections.push(view.connection)
    harness.exports.push(view.exportState.phase)
  })
  controller.start()
  await harness.tick(2)
  return harness
}

async function runToEnd(harness: Harness): Promise<void> {
  for (let step = 0; step < 200; step += 1) {
    const status = harness.controller.getView().snapshot?.status
    if (status === "completed" || status === "failed" || status === "stopped") return
    await harness.tick()
  }
}

describe("fixture scenarios reach every controller phase", () => {
  it("start_rejected reaches sending and failed", async () => {
    const harness = await boot("start_rejected")
    await harness.controller.startRun(1)
    expect(harness.commands).toEqual(expect.arrayContaining(["sending", "failed"]))
  })

  it("success reaches awaiting through a manual stop", async () => {
    const harness = await boot("success")
    await harness.controller.startRun(1)
    await harness.tick(4)
    await harness.controller.stopRun()
    expect(harness.controller.getView().command.phase).toBe("awaiting")
    await harness.tick(3)
    expect(harness.controller.getView().snapshot?.status).toBe("stopped")
    expect(harness.controller.getView().command.phase).toBe("idle")
  })

  it("command_unknown reaches unknown, offers a retry and completes it", async () => {
    const harness = await boot("command_unknown")
    await harness.controller.startRun(1)
    await harness.tick(4)
    await harness.controller.stopRun()
    expect(harness.controller.getView().command.phase).toBe("unknown")
    await harness.tick(2)
    expect(harness.controller.getView().command.canRetry).toBe(true)
    await harness.controller.retryCommand()
    await harness.tick(3)
    expect(harness.controller.getView().snapshot?.status).toBe("stopped")
  })

  it("disconnect goes connecting, live, stale and live again", async () => {
    const harness = await boot("disconnect")
    await harness.controller.startRun(1)
    await runToEnd(harness)
    const order = harness.connections.filter((state, index, all) => state !== all[index - 1])
    expect(order).toEqual(expect.arrayContaining(["live", "stale"]))
    expect(order.indexOf("stale")).toBeLessThan(order.lastIndexOf("live"))
    expect(harness.controller.getView().connection).toBe("live")
  })

  it("journal_long reaches exporting, failed, cancelled and a successful export", async () => {
    const harness = await boot("journal_long")
    await harness.controller.startRun(1)
    await runToEnd(harness)
    await harness.tick(4)
    expect(harness.controller.getView().journal.entries.length).toBeGreaterThan(400)
    const failing = harness.controller.exportJournal()
    await harness.tick(6)
    expect(await failing).toBeNull()
    expect(harness.controller.getView().exportState.phase).toBe("failed")
    const succeeding = harness.controller.exportJournal()
    await harness.tick(8)
    expect((await succeeding)?.entry_count ?? 0).toBeGreaterThan(400)
    const cancelled = harness.controller.exportJournal()
    await harness.controller.startRun(2)
    await harness.tick(6)
    expect(await cancelled).toBeNull()
    expect(harness.exports).toEqual(
      expect.arrayContaining(["exporting", "failed", "idle", "cancelled"]),
    )
  })
})
