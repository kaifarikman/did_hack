import { act, fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { buildScript } from "@/adapters/fixture/catalog"
import type { MissionController } from "@/application/missionController"
import { EMPTY_JOURNAL, type ExportPhase, type MissionViewState } from "@/application/viewState"
import type { JournalEntry, TeamView } from "@/domain/contract"
import type { JournalExport } from "@/domain/journal"
import { JournalCard } from "@/ui/features/journal/journal-card"
import { JOURNAL_PAGE_SIZE, visibleWindow } from "@/ui/features/journal/paging"
import { TeamCard } from "@/ui/features/team/team-card"
import { renderWithLocale } from "./render"
import { controllerSpy, frame, RU, viewOf } from "./views"

function longEntries(count: number): JournalEntry[] {
  const template = buildScript("medium_adaptation").journal[0]?.entry
  if (template === undefined) throw new Error("entry expected")
  return Array.from({ length: count }, (_, index) => ({ ...template, sequence: index + 1 }))
}

function chainEntries(): JournalEntry[] {
  return buildScript("medium_adaptation").journal.map((item, index) => ({
    ...item.entry,
    sequence: index + 1,
  }))
}

function journalView(entries: JournalEntry[], patch: Partial<MissionViewState> = {}) {
  return viewOf({
    snapshot: frame("medium_adaptation", -1),
    journal: { ...EMPTY_JOURNAL, runId: "run-1", entries },
    ...patch,
  })
}

function renderCard(
  view: MissionViewState,
  controller: MissionController,
  exported: (result: JournalExport) => void = () => undefined,
) {
  return renderWithLocale(
    <JournalCard view={view} controller={controller} onExported={exported} motionIndex={0} />,
  )
}

describe("journal paging", () => {
  it("cuts a window from the end of the list", () => {
    expect(visibleWindow([1, 2, 3, 4], 2)).toEqual({ entries: [3, 4], hidden: 2 })
    expect(visibleWindow([1, 2], 5)).toEqual({ entries: [1, 2], hidden: 0 })
  })

  it("renders one page of a long journal and loads earlier entries on demand", () => {
    const { controller } = controllerSpy()
    const total = JOURNAL_PAGE_SIZE * 2 + 5
    const { container } = renderCard(journalView(longEntries(total)), controller)
    expect(container.querySelectorAll("li[data-kind]")).toHaveLength(JOURNAL_PAGE_SIZE)
    const more = RU.journal.loadMore.replace("{{count}}", String(total - JOURNAL_PAGE_SIZE))
    fireEvent.click(screen.getByRole("button", { name: more }))
    expect(container.querySelectorAll("li[data-kind]")).toHaveLength(JOURNAL_PAGE_SIZE * 2)
  })
})

describe("journal states", () => {
  it("shows a skeleton before the first snapshot", async () => {
    const { controller } = controllerSpy()
    const { container } = renderCard(viewOf({ snapshot: null }), controller)
    await new Promise((resolve) => setTimeout(resolve, 260))
    expect(container.querySelector("[data-skeleton]")).not.toBeNull()
  })

  it("shows a load error", () => {
    const { controller } = controllerSpy()
    renderCard(
      journalView([], { journal: { ...EMPTY_JOURNAL, error: { key: "errors:kind.network" } } }),
      controller,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it.each(["failed", "cancelled"] as const)("explains a %s export", (phase) => {
    const { controller } = controllerSpy()
    renderCard(
      journalView(chainEntries(), { exportState: { phase, message: null, cause: null } }),
      controller,
    )
    expect(screen.getByText(RU.journal.export[phase])).toBeTruthy()
  })

  it("marks the export button busy while exporting", () => {
    const { controller } = controllerSpy()
    const exporting: ExportPhase = "exporting"
    renderCard(
      journalView(chainEntries(), {
        exportState: { phase: exporting, message: null, cause: null },
      }),
      controller,
    )
    const button = screen.getByRole("button", { name: RU.journal.export.exporting })
    expect(button.getAttribute("aria-busy")).toBe("true")
  })

  it("hands the export over and confirms it", async () => {
    const result: JournalExport = {
      run_id: "run-1",
      last_sequence: 3,
      entry_count: 3,
      entries: chainEntries().slice(0, 3),
    }
    const { controller } = controllerSpy()
    Object.assign(controller, { exportJournal: () => Promise.resolve(result) })
    const received: JournalExport[] = []
    const card = renderCard(journalView(chainEntries()), controller, (value: JournalExport) =>
      received.push(value),
    )
    const button = within(card.container).getByRole("button", {
      name: RU.journal.export.action,
    })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(received).toEqual([result])
    expect(within(card.container).getByText(RU.journal.export.done)).toBeTruthy()
  })

  it("narrows the list to one hypothesis chain", () => {
    const entries = chainEntries()
    const id = entries.find((entry) => entry.hypothesis_id !== null)?.hypothesis_id ?? null
    const related = entries.filter((entry) => entry.hypothesis_id === id)
    const { controller } = controllerSpy()
    const { container } = renderCard(
      journalView(entries, { selectedHypothesisId: id }),
      controller,
    )
    expect(container.querySelectorAll("li[data-kind]")).toHaveLength(related.length)
    expect(screen.getByRole("button", { name: RU.journal.hideChain })).toBeTruthy()
  })

  it("names the chain by hypothesis number, not by id", () => {
    const entries = chainEntries()
    const { controller, calls } = controllerSpy()
    renderCard(journalView(entries), controller)
    const withChain = entries.find((entry) => entry.hypothesis_id !== null)
    if (withChain === undefined) throw new Error("chain expected")
    fireEvent.click(screen.getAllByText(withChain.title)[0] as HTMLElement)
    fireEvent.click(
      screen.getAllByRole("button", {
        name: RU.journal.showChain.replace("{{number}}", "1"),
      })[0] as HTMLElement,
    )
    expect(calls).toContain(`selectHypothesis(${withChain.hypothesis_id})`)
  })
})

function teamWith(outcome: TeamView["outcome"]): TeamView {
  const team = frame("team_success", -1).team
  if (team === null) throw new Error("team expected")
  return { ...team, outcome, lost_robots: [] }
}

describe("TeamCard outcomes", () => {
  it.each(["running", "success", "partial", "failed", "stopped"] as const)(
    "shows the %s team outcome",
    (outcome) => {
      renderWithLocale(
        <TeamCard
          team={teamWith(outcome)}
          batteryInitial={60}
          robotStatusLabel={() => "status"}
          goalLabel={() => null}
          motionIndex={0}
        />,
      )
      expect(screen.getByText(RU.team.outcome[outcome])).toBeTruthy()
    },
  )

  it("names robots by number and puts each in its own inner card", () => {
    const { container } = renderWithLocale(
      <TeamCard
        team={teamWith("running")}
        batteryInitial={60}
        robotStatusLabel={() => "status"}
        goalLabel={() => null}
        motionIndex={0}
      />,
    )
    expect(screen.getByText(RU.team.robot.name.replace("{{number}}", "1"))).toBeTruthy()
    expect(screen.queryByText("robot_1")).toBeNull()
    expect(container.querySelectorAll("[data-robot][data-level='inner']")).toHaveLength(2)
  })
})
