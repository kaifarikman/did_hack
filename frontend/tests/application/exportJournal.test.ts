import { describe, expect, it } from "vitest"
import { ApiError } from "../../src/application/errors"
import {
  ExportCancelledError,
  ExportFailedError,
  exportFullJournal,
} from "../../src/application/exportJournal"
import type { MissionGateway } from "../../src/application/ports"
import type { JournalEntry, JournalPage } from "../../src/domain/contract"
import { entry } from "../support"

class ScriptedJournal {
  entries: JournalEntry[]
  calls: Array<{ after: number; limit: number }> = []
  hooks: Array<(callIndex: number) => void | Promise<void>> = []
  failOnCall: number | null = null
  overrideByCall = new Map<number, JournalPage>()

  constructor(count: number) {
    this.entries = Array.from({ length: count }, (_unused, index) => entry(index + 1))
  }

  gateway(runId = "run-a", pageSizeCap = 200): MissionGateway {
    const journal = this
    return {
      async getJournalPage(requestedRun, after, limit) {
        const callIndex = journal.calls.length
        journal.calls.push({ after, limit })
        for (const hook of journal.hooks) await hook(callIndex)
        if (journal.failOnCall === callIndex)
          throw new ApiError(503, "unavailable", "failure", true)
        const override = journal.overrideByCall.get(callIndex)
        if (override !== undefined) return override
        const matching = journal.entries.filter((item) => item.sequence > after)
        const page = matching.slice(0, Math.min(limit, pageSizeCap))
        const last = page[page.length - 1]
        return {
          run_id: requestedRun === runId ? runId : requestedRun,
          entries: page,
          next_sequence: last?.sequence ?? after,
          has_more: matching.length > page.length,
        }
      },
    } as MissionGateway
  }
}

const never = () => false

describe("full journal export", () => {
  it("reads a journal longer than two pages and matches the full content", async () => {
    const journal = new ScriptedJournal(7)
    const result = await exportFullJournal(journal.gateway("run-a", 3), "run-a", {
      isCancelled: never,
    })
    expect(journal.calls.map((call) => call.after)).toEqual([0, 3, 6])
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result).toMatchObject({ run_id: "run-a", last_sequence: 7, entry_count: 7 })
  })

  it("a repeated or overlapping page does not duplicate entries", async () => {
    const journal = new ScriptedJournal(4)
    journal.overrideByCall.set(1, {
      run_id: "run-a",
      entries: [entry(2), entry(3), entry(4)],
      next_sequence: 4,
      has_more: false,
    })
    const gateway = journal.gateway("run-a", 2)
    const result = await exportFullJournal(gateway, "run-a", { isCancelled: never })
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4])
  })

  it("an empty journal gives a valid empty file with cursor 0", async () => {
    const result = await exportFullJournal(new ScriptedJournal(0).gateway(), "run-a", {
      isCancelled: never,
    })
    expect(result).toMatchObject({ entry_count: 0, last_sequence: 0, entries: [] })
  })

  it("a page that does not advance the cursor with has_more fails instead of looping", async () => {
    const journal = new ScriptedJournal(2)
    journal.overrideByCall.set(0, {
      run_id: "run-a",
      entries: [entry(1)],
      next_sequence: 1,
      has_more: true,
    })
    journal.overrideByCall.set(1, {
      run_id: "run-a",
      entries: [],
      next_sequence: 1,
      has_more: true,
    })
    await expect(
      exportFullJournal(journal.gateway(), "run-a", { isCancelled: never }),
    ).rejects.toBeInstanceOf(ExportFailedError)
  })

  it("a failure in the middle gives no partial file", async () => {
    const journal = new ScriptedJournal(7)
    journal.failOnCall = 1
    await expect(
      exportFullJournal(journal.gateway("run-a", 3), "run-a", { isCancelled: never }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it("entries added during the export stop at the last next_sequence; later ones go to the next export", async () => {
    const journal = new ScriptedJournal(4)
    journal.hooks.push((callIndex) => {
      if (callIndex === 1) journal.entries.push(entry(5), entry(6))
    })
    const result = await exportFullJournal(journal.gateway("run-a", 2), "run-a", {
      isCancelled: never,
    })
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.last_sequence).toBe(6)

    journal.entries.push(entry(7))
    const next = await exportFullJournal(journal.gateway("run-a", 2), "run-a", {
      isCancelled: never,
    })
    expect(next.entries).toHaveLength(7)
    expect(result.entries).toHaveLength(6)
  })

  it("a run change during the export cancels it", async () => {
    const journal = new ScriptedJournal(7)
    let cancelled = false
    journal.hooks.push((callIndex) => {
      if (callIndex === 1) cancelled = true
    })
    await expect(
      exportFullJournal(journal.gateway("run-a", 3), "run-a", { isCancelled: () => cancelled }),
    ).rejects.toBeInstanceOf(ExportCancelledError)
  })

  it("a journal of another run is rejected", async () => {
    const journal = new ScriptedJournal(1)
    journal.overrideByCall.set(0, {
      run_id: "run-b",
      entries: [entry(1)],
      next_sequence: 1,
      has_more: false,
    })
    await expect(
      exportFullJournal(journal.gateway(), "run-a", { isCancelled: never }),
    ).rejects.toBeInstanceOf(ExportFailedError)
  })
})
