import { ApiError, NetworkError, RequestTimeoutError } from "../../application/errors"
import { EXPORT_PAGE_SIZE } from "../../application/exportJournal"
import type { MissionGateway } from "../../application/ports"
import type {
  HealthStatus,
  JournalEntry,
  JournalPage,
  MapData,
  MissionSnapshot,
  StartRunRequest,
  StopRunRequest,
} from "../../domain/contract"
import { ACTIVE_STATUSES } from "../../domain/contract"
import { buildScript, DEFAULT_FIXTURE_SCENARIO, type FixtureScenarioName } from "./catalog"
import { journalEntryFrom } from "./content"
import gatewayContent from "./examples/content/gateway.json"
import { FixtureRun } from "./fixtureRun"
import { type FixtureScript, healthAt, IDLE_FRAME_INDEX, mapAt } from "./script"

export interface FixtureControls {
  getScenario(): FixtureScenarioName
  setScenario(name: FixtureScenarioName): void
}

interface FixtureGatewayOptions {
  wait?: (delayMs: number) => Promise<void>
}

const EXPORT_PAGE_DELAY_MS = 900
const MAX_JOURNAL_LIMIT = 200
const MESSAGES = gatewayContent.errors
const STOP_DECISION = journalEntryFrom(gatewayContent.stopDecision)

function clone<T>(value: T): T {
  return structuredClone(value)
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export class FixtureMissionGateway implements MissionGateway, FixtureControls {
  private scenario: FixtureScenarioName = DEFAULT_FIXTURE_SCENARIO
  private script: FixtureScript = buildScript(DEFAULT_FIXTURE_SCENARIO)
  private runCounter = 0
  private run: FixtureRun | null = null
  private healthCalls = 0
  private outageRemaining = 0
  private startRejectionsLeft = 0
  private stopTimeoutsLeft = 0
  private exportFailuresLeft = 0
  private readonly startedRequests = new Map<string, MissionSnapshot>()
  private readonly wait: (delayMs: number) => Promise<void>

  constructor(options: FixtureGatewayOptions = {}) {
    this.wait = options.wait ?? waitFor
    this.setScenario(DEFAULT_FIXTURE_SCENARIO)
  }

  getScenario(): FixtureScenarioName {
    return this.scenario
  }

  setScenario(name: FixtureScenarioName): void {
    this.scenario = name
    this.script = buildScript(name)
    this.healthCalls = 0
    const { behavior } = this.script
    this.startRejectionsLeft = behavior.startRejections
    this.stopTimeoutsLeft = behavior.stopTimeouts
    this.exportFailuresLeft = behavior.exportFailures
  }

  private currentHealth(): HealthStatus | null {
    return healthAt(this.script, this.healthCalls - 1)
  }

  async getHealth(): Promise<HealthStatus> {
    if (this.outageRemaining > 0) throw new NetworkError(gatewayContent.outage)
    this.healthCalls += 1
    const health = this.currentHealth()
    if (health === null) throw new NetworkError(gatewayContent.outage)
    return clone(health)
  }

  async getMap(): Promise<MapData> {
    const script = this.run?.script ?? this.script
    const map = mapAt(script, this.run?.deliveredFrame ?? IDLE_FRAME_INDEX)
    if (map === null) throw new ApiError(404, "map_not_ready", MESSAGES.mapNotReady, true)
    return clone(map)
  }

  async getState(): Promise<MissionSnapshot> {
    const run = this.run
    if (run === null) return clone(this.script.idle)
    if (this.outageRemaining > 0) {
      this.outageRemaining -= 1
      throw new NetworkError(gatewayContent.outage)
    }
    const outage = run.script.behavior.outage
    if (outage !== null && !run.outageTriggered && run.pendingFrame === outage.atFrame) {
      run.outageTriggered = true
      this.outageRemaining = outage.requests - 1
      throw new NetworkError(gatewayContent.outage)
    }
    return clone(run.next())
  }

  async startRun(request: StartRunRequest): Promise<MissionSnapshot> {
    const known = this.startedRequests.get(request.request_id)
    if (known !== undefined) return clone(known)
    if (!Number.isInteger(request.seed)) {
      throw new ApiError(422, "invalid_request", MESSAGES.invalidSeed, false)
    }
    const health = this.currentHealth() ?? healthAt(this.script, 0)
    const environmentReady =
      health !== null && health.status === "ready" && health.ros_connected
    if (this.startRejectionsLeft > 0 || !environmentReady) {
      this.startRejectionsLeft = Math.max(this.startRejectionsLeft - 1, 0)
      throw new ApiError(503, "environment_not_ready", MESSAGES.environmentNotReady, true)
    }
    if (this.run !== null && ACTIVE_STATUSES.includes(this.run.lastSnapshot.status)) {
      throw new ApiError(409, "run_active", MESSAGES.runActive, false)
    }
    this.runCounter += 1
    this.run = new FixtureRun({
      runId: `fixture-run-${String(this.runCounter).padStart(3, "0")}`,
      seed: request.seed,
      script: this.script,
    })
    const snapshot = this.run.next()
    this.startedRequests.set(request.request_id, snapshot)
    return clone(snapshot)
  }

  async stopRun(runId: string, _request: StopRunRequest): Promise<MissionSnapshot> {
    const run = this.run
    if (run === null || run.runId !== runId) {
      throw new ApiError(
        run === null ? 404 : 409,
        "run_not_current",
        MESSAGES.runNotCurrent,
        false,
      )
    }
    if (this.stopTimeoutsLeft > 0) {
      this.stopTimeoutsLeft -= 1
      throw new RequestTimeoutError(gatewayContent.stopTimeout)
    }
    if (run.requestStop()) {
      run.addEntry({ ...STOP_DECISION, simulation_time_s: run.lastSnapshot.simulation_time_s })
    }
    return clone(run.lastSnapshot)
  }

  async getJournalPage(
    runId: string,
    afterSequence: number,
    limit: number,
  ): Promise<JournalPage> {
    const run = this.run
    if (run === null || run.runId !== runId) {
      throw new ApiError(404, "run_not_found", MESSAGES.runNotFound, false)
    }
    if (
      !Number.isInteger(afterSequence) ||
      afterSequence < 0 ||
      limit < 1 ||
      limit > MAX_JOURNAL_LIMIT
    ) {
      throw new ApiError(422, "invalid_params", MESSAGES.invalidParams, false)
    }
    await this.throttleExport(run, afterSequence, limit)
    if (run.consumeJournalFailure()) {
      throw new NetworkError(MESSAGES.journalUnavailable)
    }
    return this.page(run, afterSequence, limit)
  }

  private async throttleExport(
    run: FixtureRun,
    afterSequence: number,
    limit: number,
  ): Promise<void> {
    if (limit !== EXPORT_PAGE_SIZE) return
    if (run.script.behavior.slowExport) await this.wait(EXPORT_PAGE_DELAY_MS)
    if (afterSequence > 0 && this.exportFailuresLeft > 0) {
      this.exportFailuresLeft -= 1
      throw new ApiError(503, "journal_unavailable", MESSAGES.journalUnavailable, true)
    }
  }

  private page(run: FixtureRun, afterSequence: number, limit: number): JournalPage {
    const all: JournalEntry[] = run.visibleEntries()
    const matching = all.filter((entry) => entry.sequence > afterSequence)
    const entries = matching.slice(0, limit)
    const last = entries[entries.length - 1]
    return {
      run_id: run.runId,
      entries: clone(entries),
      next_sequence: last === undefined ? afterSequence : last.sequence,
      has_more: matching.length > entries.length,
    }
  }
}
