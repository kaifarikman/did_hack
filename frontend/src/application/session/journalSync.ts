import type { JournalPage, MissionSnapshot } from "../../domain/contract"
import { mergeJournalEntries } from "../../domain/journal"
import { isActiveStatus } from "../../domain/status"
import { describeError } from "../errorDescription"
import type { JournalState } from "../viewState"
import type { ControllerSession } from "./session"

function needsJournalSync(snapshot: MissionSnapshot, journal: JournalState): boolean {
  if (snapshot.run_id === null || journal.runId !== snapshot.run_id) return false
  const upToDate =
    !isActiveStatus(snapshot.status) &&
    !journal.hasMore &&
    journal.fetchedRevision === snapshot.revision
  return !upToDate
}

function withJournalPage(
  journal: JournalState,
  page: JournalPage,
  revision: number,
): JournalState {
  return {
    ...journal,
    entries: mergeJournalEntries(journal.entries, page.entries),
    nextSequence: Math.max(journal.nextSequence, page.next_sequence),
    hasMore: page.has_more,
    fetchedRevision: revision,
    error: null,
  }
}

export class JournalSync {
  private inFlight = false

  constructor(private readonly session: ControllerSession) {}

  reset(): void {
    this.inFlight = false
  }

  async sync(): Promise<void> {
    const session = this.session
    const snapshot = session.current.snapshot
    if (!session.running || this.inFlight || snapshot === null || snapshot.run_id === null)
      return
    if (!needsJournalSync(snapshot, session.current.journal)) return
    const runId = snapshot.run_id
    const generation = session.generation
    this.inFlight = true
    try {
      await this.readPages(runId, generation, snapshot.revision)
    } catch (error) {
      if (session.isCurrent(generation) && session.current.journal.runId === runId) {
        session.update({ journal: { ...session.current.journal, error: describeError(error) } })
      }
    } finally {
      if (session.generation === generation) this.inFlight = false
    }
  }

  private async readPages(runId: string, generation: number, revision: number): Promise<void> {
    const session = this.session
    let hasMore = true
    while (hasMore) {
      const page = await session.gateway.getJournalPage(
        runId,
        session.current.journal.nextSequence,
        session.timing.journalPageSize,
        { signal: session.signal },
      )
      const stillCurrent =
        session.isCurrent(generation) &&
        session.current.journal.runId === runId &&
        page.run_id === runId
      if (!stillCurrent) return
      const latest = session.current.journal
      const progressed = page.next_sequence > latest.nextSequence
      session.update({ journal: withJournalPage(latest, page, revision) })
      hasMore = page.has_more && progressed
    }
  }
}
