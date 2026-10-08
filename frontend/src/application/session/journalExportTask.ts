import type { JournalExport } from "../../domain/journal"
import { msg } from "../../domain/message"
import { describeError } from "../errorDescription"
import { ExportCancelledError, exportFullJournal } from "../exportJournal"
import { IDLE_EXPORT } from "../viewState"
import type { ControllerSession } from "./session"

export class JournalExportTask {
  private inFlightGeneration: number | null = null

  constructor(private readonly session: ControllerSession) {}

  async run(): Promise<JournalExport | null> {
    const session = this.session
    const runId = session.current.snapshot?.run_id ?? null
    if (this.inFlightGeneration === session.generation || !session.running) return null
    if (runId === null) {
      session.update({
        exportState: { phase: "failed", message: msg("errors:export.noRun"), cause: null },
      })
      return null
    }
    const generation = session.generation
    this.inFlightGeneration = generation
    session.update({ exportState: { phase: "exporting", message: null, cause: null } })
    try {
      const result = await exportFullJournal(session.gateway, runId, {
        signal: session.signal,
        isCancelled: () =>
          !session.isCurrent(generation) || session.current.snapshot?.run_id !== runId,
      })
      if (!session.isCurrent(generation)) return null
      session.update({ exportState: IDLE_EXPORT })
      return result
    } catch (error) {
      if (session.isCurrent(generation)) this.report(error)
      return null
    } finally {
      if (this.inFlightGeneration === generation) this.inFlightGeneration = null
    }
  }

  private report(error: unknown): void {
    if (error instanceof ExportCancelledError) {
      this.session.update({
        exportState: { phase: "cancelled", message: error.descriptor, cause: null },
      })
      return
    }
    this.session.update({
      exportState: {
        phase: "failed",
        message: msg("errors:export.failed"),
        cause: describeError(error),
      },
    })
  }
}
