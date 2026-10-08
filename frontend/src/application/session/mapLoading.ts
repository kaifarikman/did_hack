import { describeError } from "../errorDescription"
import type { ControllerSession } from "./session"

export class MapLoading {
  private inFlight = false
  private lastAttemptAt: number | null = null

  constructor(private readonly session: ControllerSession) {}

  reset(): void {
    this.inFlight = false
    this.lastAttemptAt = null
  }

  refresh(): void {
    this.session.update({ map: null })
    this.lastAttemptAt = null
    this.ensure()
  }

  ensure(): void {
    const session = this.session
    if (!session.running || this.inFlight) return
    const wantedMapId = session.current.snapshot?.map_id ?? null
    const loaded = session.current.map
    const needed = loaded === null || (wantedMapId !== null && loaded.map_id !== wantedMapId)
    if (!needed) return
    const now = session.scheduler.now()
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < session.timing.mapRetryMs)
      return
    this.lastAttemptAt = now
    void this.load()
  }

  private async load(): Promise<void> {
    const session = this.session
    this.inFlight = true
    const generation = session.generation
    try {
      const map = await session.gateway.getMap({ signal: session.signal })
      if (session.isCurrent(generation)) session.update({ map, mapError: null })
    } catch (error) {
      if (session.isCurrent(generation)) session.update({ mapError: describeError(error) })
    } finally {
      if (session.generation === generation) this.inFlight = false
    }
  }
}
