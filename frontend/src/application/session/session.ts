import type { MissionGateway, Scheduler } from "../ports"
import { INITIAL_VIEW, type MissionViewState } from "../viewState"

export interface SessionTiming {
  readonly pollIntervalMs: number
  readonly staleAfterMs: number
  readonly healthIntervalMs: number
  readonly mapRetryMs: number
  readonly journalPageSize: number
  readonly awaitTimeoutMs: number
}

export class ControllerSession {
  private view: MissionViewState = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private lifecycle: AbortController | null = null
  private cancelTimers: Array<() => void> = []

  running = false
  generation = 0
  startedAt = 0
  lastSuccessAt: number | null = null
  private requestSeq = 0

  constructor(
    readonly gateway: MissionGateway,
    readonly scheduler: Scheduler,
    readonly timing: SessionTiming,
  ) {}

  get current(): MissionViewState {
    return this.view
  }

  get signal(): AbortSignal | undefined {
    return this.lifecycle?.signal
  }

  get lastRequestSeq(): number {
    return this.requestSeq
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(patch: Partial<MissionViewState>): void {
    this.view = { ...this.view, ...patch }
    for (const listener of this.listeners) listener()
  }

  begin(): void {
    this.running = true
    this.generation += 1
    this.lifecycle = new AbortController()
    this.startedAt = this.scheduler.now()
  }

  end(): void {
    this.running = false
    this.generation += 1
    this.lifecycle?.abort()
    this.lifecycle = null
    for (const cancel of this.cancelTimers) cancel()
    this.cancelTimers = []
  }

  isCurrent(generation: number): boolean {
    return this.running && this.generation === generation
  }

  schedule(callback: () => void, delayMs: number): void {
    let cancel: () => void = () => undefined
    cancel = this.scheduler.setTimeout(() => {
      this.cancelTimers = this.cancelTimers.filter((timer) => timer !== cancel)
      callback()
    }, delayMs)
    this.cancelTimers.push(cancel)
  }

  nextRequestSeq(): number {
    this.requestSeq += 1
    return this.requestSeq
  }

  markLive(): void {
    this.lastSuccessAt = this.scheduler.now()
    this.update({ connection: "live", connectionError: null })
  }
}
