import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { KNOWN_API_CODES } from "../../src/application/errorDescription"
import {
  type CommandState,
  connectionStatus,
  IDLE_COMMAND,
  INITIAL_VIEW,
  type MissionViewState,
  START_BLOCKERS,
  STOP_BLOCKERS,
  startDisabledReason,
  stopDisabledReason,
} from "../../src/application/viewState"
import { idle, readyHealth, snapshotWith } from "../support"

const live = (patch: Partial<MissionViewState> = {}): MissionViewState => ({
  ...INITIAL_VIEW,
  connection: "live",
  health: readyHealth,
  snapshot: idle(),
  ...patch,
})
const busy: CommandState = { ...IDLE_COMMAND, phase: "sending", kind: "start" }
const running = snapshotWith({ run_id: "run-a", status: "running" })

describe("start blockers", () => {
  it.each([
    [{ snapshot: null }, "no_snapshot"],
    [{ connection: "stale" as const }, "offline"],
    [{ health: null }, "health_unknown"],
    [{ health: { ...readyHealth, status: "starting" as const } }, "environment_starting"],
    [{ command: busy }, "command_busy"],
    [{ snapshot: running }, "run_active"],
  ])("reports %o as %s", (patch, blocker) => {
    expect(startDisabledReason(live(patch))).toBe(blocker)
  })

  it("allows start when everything is ready", () => {
    expect(startDisabledReason(live())).toBeNull()
    expect(START_BLOCKERS).toHaveLength(6)
  })
})

describe("stop blockers", () => {
  it.each([
    [{ snapshot: idle() }, "no_run"],
    [{ snapshot: running, connection: "connecting" as const }, "offline"],
    [{ snapshot: running, command: busy }, "command_busy"],
    [{ snapshot: snapshotWith({ run_id: "run-a", status: "completed" }) }, "run_inactive"],
    [{ snapshot: snapshotWith({ run_id: "run-a", status: "stopping" }) }, "already_stopping"],
  ])("reports %o as %s", (patch, blocker) => {
    expect(stopDisabledReason(live(patch))).toBe(blocker)
  })

  it("allows stop for an active run", () => {
    expect(stopDisabledReason(live({ snapshot: running }))).toBeNull()
    expect(STOP_BLOCKERS).toHaveLength(5)
  })
})

describe("error dictionary", () => {
  it.each(["ru", "en"])("has a %s message for every known api code", (locale) => {
    const path = resolve(process.cwd(), `src/ui/shared/i18n/locales/${locale}/errors.json`)
    const dictionary = JSON.parse(readFileSync(path, "utf8")) as { api: Record<string, string> }
    for (const code of KNOWN_API_CODES) expect(dictionary.api[code], code).toBeTruthy()
  })
})

describe("connection status", () => {
  it.each([
    [{ connection: "connecting" as const }, "connecting"],
    [{}, "live"],
    [{ connection: "stale" as const }, "stale"],
    [{ connection: "stale" as const, snapshot: null }, "offline"],
  ])("reads %o as %s", (patch, status) => {
    expect(connectionStatus(live(patch))).toBe(status)
  })
})
