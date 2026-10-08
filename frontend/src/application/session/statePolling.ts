import type { MissionSnapshot } from "../../domain/contract"
import { describeError } from "../errorDescription"
import type { ControllerSession } from "./session"

export const STALE_CHECK_MAX_MS = 500

export interface StatePollingHooks {
  readonly onSnapshot: (snapshot: MissionSnapshot, seq: number) => void
  readonly onTick: () => void
}

export class StatePolling {
  private stateInFlight = false
  private healthInFlight = false

  constructor(
    private readonly session: ControllerSession,
    private readonly hooks: StatePollingHooks,
  ) {}

  start(): void {
    this.stateInFlight = false
    this.healthInFlight = false
    void this.pollState()
    void this.pollHealth()
    this.scheduleStaleCheck()
  }

  private async pollState(): Promise<void> {
    const session = this.session
    if (!session.running || this.stateInFlight) return
    this.stateInFlight = true
    const generation = session.generation
    const startedAt = session.scheduler.now()
    const seq = session.nextRequestSeq()
    try {
      const snapshot = await session.gateway.getState({ signal: session.signal })
      if (session.isCurrent(generation)) this.hooks.onSnapshot(snapshot, seq)
    } catch (error) {
      if (session.isCurrent(generation))
        session.update({ connectionError: describeError(error) })
    } finally {
      if (session.generation === generation) {
        this.stateInFlight = false
        if (session.running) {
          const elapsed = session.scheduler.now() - startedAt
          const delay = Math.max(session.timing.pollIntervalMs - elapsed, 0)
          session.schedule(() => void this.pollState(), delay)
        }
      }
    }
  }

  private async pollHealth(): Promise<void> {
    const session = this.session
    if (!session.running || this.healthInFlight) return
    this.healthInFlight = true
    const generation = session.generation
    try {
      const health = await session.gateway.getHealth({ signal: session.signal })
      if (session.isCurrent(generation)) session.update({ health })
    } catch {
      if (session.isCurrent(generation)) session.update({ health: null })
    } finally {
      if (session.generation === generation) {
        this.healthInFlight = false
        if (session.running) {
          session.schedule(() => void this.pollHealth(), session.timing.healthIntervalMs)
        }
      }
    }
  }

  private scheduleStaleCheck(): void {
    const session = this.session
    const generation = session.generation
    session.schedule(
      () => {
        if (!session.isCurrent(generation)) return
        this.checkStaleness()
        this.hooks.onTick()
        this.scheduleStaleCheck()
      },
      Math.min(session.timing.pollIntervalMs, STALE_CHECK_MAX_MS),
    )
  }

  private checkStaleness(): void {
    const session = this.session
    const baseline = session.lastSuccessAt ?? session.startedAt
    const expired = session.scheduler.now() - baseline >= session.timing.staleAfterMs
    if (expired && session.current.connection !== "stale")
      session.update({ connection: "stale" })
  }
}
