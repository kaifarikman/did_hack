import type { JournalEntry, MissionSnapshot } from "../../domain/contract"
import { ACTIVE_STATUSES } from "../../domain/contract"
import type { JournalContent } from "./content"
import { type FixtureScript, IDLE_FRAME_INDEX } from "./script"

interface FixtureRunOptions {
  runId: string
  seed: number
  script: FixtureScript
}

type StopPhase = "none" | "requested" | "stopping" | "stopped"

export class FixtureRun {
  readonly runId: string
  readonly seed: number
  readonly script: FixtureScript
  lastSnapshot: MissionSnapshot
  deliveredFrame = IDLE_FRAME_INDEX
  outageTriggered = false
  private nextFrame = 0
  private revision = 0
  private stopPhase: StopPhase = "none"
  private journalFailureUsed = false
  private scriptedCursor = 0
  private readonly log: JournalEntry[] = []

  constructor(options: FixtureRunOptions) {
    this.runId = options.runId
    this.seed = options.seed
    this.script = options.script
    this.lastSnapshot = options.script.idle
  }

  get pendingFrame(): number {
    return this.nextFrame
  }

  next(): MissionSnapshot {
    if (this.stopPhase === "requested") {
      this.stopPhase = "stopping"
      return this.emit({ ...this.lastSnapshot, status: "stopping" }, false)
    }
    if (this.stopPhase !== "none") {
      this.stopPhase = "stopped"
      const halted = {
        current_goal: null,
        planned_path: [],
        navigation:
          this.lastSnapshot.navigation === null
            ? null
            : { ...this.lastSnapshot.navigation, phase: "stopped" as const },
      }
      return this.emit({ ...this.lastSnapshot, ...halted, status: "stopped" }, true)
    }
    const lastIndex = this.script.frames.length - 1
    const index = Math.min(this.nextFrame, lastIndex)
    const frame = this.script.frames[index]
    if (frame === undefined) return this.lastSnapshot
    const atEnd = this.nextFrame >= lastIndex
    if (!atEnd) this.nextFrame += 1
    this.deliveredFrame = index
    this.revealJournal()
    return this.emit(frame, atEnd)
  }

  requestStop(): boolean {
    if (!ACTIVE_STATUSES.includes(this.lastSnapshot.status) || this.stopPhase !== "none")
      return false
    this.stopPhase = "requested"
    return true
  }

  addEntry(entry: JournalContent): void {
    this.log.push({ ...entry, sequence: this.log.length + 1 })
  }

  visibleEntries(): JournalEntry[] {
    return this.log
  }

  consumeJournalFailure(): boolean {
    const failAt = this.script.behavior.journalFailureAtFrame
    if (failAt === null || this.journalFailureUsed || this.deliveredFrame < failAt) return false
    this.journalFailureUsed = true
    return true
  }

  private revealJournal(): void {
    const scripted = this.script.journal
    while (this.scriptedCursor < scripted.length) {
      const item = scripted[this.scriptedCursor]
      if (item === undefined || item.atFrame > this.deliveredFrame) return
      this.addEntry(item.entry)
      this.scriptedCursor += 1
    }
  }

  private emit(frame: MissionSnapshot, repeat: boolean): MissionSnapshot {
    if (!repeat || this.lastSnapshot.status !== frame.status) this.revision += 1
    const snapshot: MissionSnapshot = {
      ...frame,
      run_id: this.runId,
      revision: this.revision,
      seed: this.seed,
    }
    this.lastSnapshot = snapshot
    return snapshot
  }
}
