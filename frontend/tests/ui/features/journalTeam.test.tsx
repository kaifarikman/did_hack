import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { buildScript } from "@/adapters/fixture/catalog"
import { EMPTY_JOURNAL, IDLE_EXPORT } from "@/application/viewState"
import type { JournalEntry } from "@/domain/contract"
import { JournalCard } from "@/ui/features/journal/journal-card"
import { TeamCard } from "@/ui/features/team/team-card"
import { renderWithLocale } from "./render"
import { controllerSpy, findFrame, frame, RU, viewOf } from "./views"

function entries(): JournalEntry[] {
  return buildScript("medium_adaptation").journal.map((item, index) => ({
    ...item.entry,
    sequence: index + 1,
  }))
}

function journalView(patch = {}) {
  return viewOf({
    snapshot: frame("medium_adaptation", -1),
    journal: { ...EMPTY_JOURNAL, runId: "run-1", entries: entries() },
    ...patch,
  })
}

describe("JournalCard", () => {
  it("animates only entries that arrive after the first render", () => {
    const { controller } = controllerSpy()
    const view = journalView()
    const { container, rerender } = renderWithLocale(
      <JournalCard
        view={view}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />,
    )
    expect(container.querySelectorAll("[data-fresh='true']")).toHaveLength(0)
    const added = { ...view.journal.entries[0], sequence: 999 } as JournalEntry
    const grown = {
      ...view,
      journal: { ...view.journal, entries: [...view.journal.entries, added] },
    }
    rerender(
      <JournalCard
        view={grown}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />,
    )
    expect(container.querySelectorAll("[data-fresh='true']")).toHaveLength(1)
    const card = (next: typeof grown) => (
      <JournalCard
        view={next}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />
    )
    rerender(card({ ...grown }))
    expect(container.querySelectorAll("[data-fresh='true']")).toHaveLength(1)
    rerender(card({ ...grown, selectedHypothesisId: "none" }))
    rerender(card({ ...grown, selectedHypothesisId: null }))
    expect(container.querySelectorAll("[data-fresh='true']")).toHaveLength(0)
  })

  it("filters entries by kind through the custom select", () => {
    const { controller } = controllerSpy()
    const { container } = renderWithLocale(
      <JournalCard
        view={journalView()}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />,
    )
    const total = container.querySelectorAll("li[data-kind]").length
    fireEvent.click(screen.getByRole("combobox", { name: RU.journal.filter.label }))
    fireEvent.click(screen.getByRole("option", { name: RU.journal.kind.outcome }))
    const kinds = [...container.querySelectorAll("li[data-kind]")].map((item) =>
      item.getAttribute("data-kind"),
    )
    expect(kinds.length).toBeLessThan(total)
    expect(new Set(kinds)).toEqual(new Set(["outcome"]))
  })

  it("narrows to one hypothesis chain and back", () => {
    const { controller, calls } = controllerSpy()
    const view = journalView({ selectedHypothesisId: "fixture-hypothesis-2" })
    const { container } = renderWithLocale(
      <JournalCard
        view={view}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />,
    )
    expect(container.querySelectorAll("li[data-kind]").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: RU.journal.hideChain }))
    expect(calls).toEqual(["selectHypothesis(null)"])
  })

  it("shows the empty state and a failed export", () => {
    const { controller } = controllerSpy()
    const view = viewOf({
      snapshot: frame("success", 2),
      exportState: { ...IDLE_EXPORT, phase: "failed" },
    })
    renderWithLocale(
      <JournalCard
        view={view}
        controller={controller}
        onExported={() => undefined}
        motionIndex={0}
      />,
    )
    expect(screen.getByText(RU.journal.empty)).toBeTruthy()
    expect(screen.getByText(RU.journal.export.failed)).toBeTruthy()
  })
})

describe("TeamCard", () => {
  const label = () => "status"

  it("stays hidden for a single robot", () => {
    const { container } = renderWithLocale(
      <TeamCard
        team={null}
        batteryInitial={60}
        robotStatusLabel={label}
        goalLabel={() => null}
        motionIndex={0}
      />,
    )
    expect(container.textContent).toBe("")
  })

  it("marks the lost partner and the partial outcome", () => {
    const team = frame("team_partial", -1).team
    const { container } = renderWithLocale(
      <TeamCard
        team={team}
        batteryInitial={60}
        robotStatusLabel={label}
        goalLabel={() => null}
        motionIndex={0}
      />,
    )
    expect(screen.getByText(RU.team.outcome.partial)).toBeTruthy()
    expect(screen.getByText(RU.team.robot.lost)).toBeTruthy()
    expect(screen.getByText(RU.team.coordination.off)).toBeTruthy()
    expect(container.querySelector("[data-lost='true']")).not.toBeNull()
  })

  it("says the team runs without its partner instead of plain running", () => {
    const lost = findFrame(
      "team_partial",
      (snapshot) =>
        snapshot.team?.outcome === "running" && snapshot.team.lost_robots.length > 0,
    )
    renderWithLocale(
      <TeamCard
        team={lost.team}
        batteryInitial={lost.battery_initial}
        robotStatusLabel={() => ""}
        goalLabel={() => null}
        motionIndex={0}
      />,
    )
    expect(screen.getByText(RU.team.outcome.runningAlone)).toBeTruthy()
    expect(screen.queryByText(RU.team.outcome.running)).toBeNull()
  })

  it("shows a partner reservation while it heads to its sample", () => {
    const team = frame("team_success", 5).team
    const { container } = renderWithLocale(
      <TeamCard
        team={team}
        batteryInitial={60}
        robotStatusLabel={label}
        goalLabel={() => null}
        motionIndex={0}
      />,
    )
    expect(container.querySelector("[data-reserved='true']")).not.toBeNull()
    expect(screen.getByText(RU.team.coordination.on)).toBeTruthy()
  })
})
