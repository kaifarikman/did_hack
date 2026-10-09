import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { INITIAL_VIEW } from "@/application/viewState"
import { AnalyticsPanel } from "@/ui/features/analytics/analytics-panel"
import ruAnalytics from "@/ui/shared/i18n/locales/ru/analytics.json"
import ruMission from "@/ui/shared/i18n/locales/ru/mission.json"
import ruResearch from "@/ui/shared/i18n/locales/ru/research.json"
import {
  experimentSnapshot,
  finishedExperiment,
  testingExperiment,
} from "../../analyticsSnapshots"
import { idle } from "../../support"
import { renderWithLocale } from "./render"

const view = () => ({
  ...INITIAL_VIEW,
  connection: "live" as const,
  snapshot: experimentSnapshot({}, { hypotheses: [], active_hypothesis_id: null }),
})

describe("AnalyticsPanel", () => {
  it("starts with advanced sections closed and no made up metrics", () => {
    const { container } = renderWithLocale(<AnalyticsPanel view={view()} onExport={vi.fn()} />)
    expect(container.querySelectorAll("details[open]")).toHaveLength(0)
    expect(screen.getAllByText(ruAnalytics.unavailable)[0]).toBeTruthy()
    expect(screen.getByText(ruAnalytics.waitingExperiment)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: ruAnalytics.export }).hasAttribute("disabled"),
    ).toBe(true)
  })
  it("labels stale telemetry and hides the active hypothesis on stop", () => {
    renderWithLocale(
      <AnalyticsPanel view={{ ...view(), connection: "stale" }} onExport={vi.fn()} />,
    )
    expect(screen.getByText(ruAnalytics.stale)).toBeTruthy()
  })
  it("changes the single graph without adding more graphs", () => {
    const { container } = renderWithLocale(<AnalyticsPanel view={view()} onExport={vi.fn()} />)
    fireEvent.click(screen.getByRole("radio", { name: ruAnalytics.signal }))
    expect(screen.getByRole("radio", { name: ruAnalytics.signal }).getAttribute("value")).toBe(
      "signal",
    )
    expect(container.querySelectorAll("svg[role='img']").length).toBeLessThanOrEqual(1)
  })
  it("shows the empty state before a run", () => {
    renderWithLocale(<AnalyticsPanel view={INITIAL_VIEW} onExport={vi.fn()} />)
    expect(screen.getByText(ruAnalytics.empty)).toBeTruthy()
  })
})

describe("AnalyticsPanel experiment lifecycle", () => {
  it("keeps retained experiments visible when the current backend has no run", () => {
    renderWithLocale(
      <AnalyticsPanel
        view={{ ...view(), snapshot: idle(), lastRunSnapshot: experimentSnapshot() }}
        onExport={vi.fn()}
      />,
    )
    expect(screen.getByRole("region", { name: ruAnalytics.lastExperiment })).toBeTruthy()
    expect(screen.getByText(testingExperiment.prediction)).toBeTruthy()
    expect(screen.getByText(ruAnalytics.lastRecordedStatus)).toBeTruthy()
    expect(screen.queryByText(ruResearch.experiment.pending)).toBeNull()
    expect(screen.getByText(ruResearch.experiment.missing)).toBeTruthy()
    expect(screen.getByText(ruAnalytics.unknown)).toBeTruthy()
    expect(screen.queryByText(ruAnalytics.testing)).toBeNull()
    expect(screen.queryByText(ruAnalytics.empty)).toBeNull()
    expect(screen.queryByText(ruMission.status.idle)).toBeNull()
  })

  it.each(["running", "returning"] as const)(
    "shows %s and the experiment before metrics arrive",
    (status) => {
      renderWithLocale(
        <AnalyticsPanel
          view={{ ...view(), snapshot: experimentSnapshot({ status }) }}
          onExport={vi.fn()}
        />,
      )
      expect(screen.getByText(ruMission.status[status])).toBeTruthy()
      expect(screen.getByText(testingExperiment.prediction)).toBeTruthy()
      expect(screen.queryByText(ruMission.status.idle)).toBeNull()
      expect(
        within(screen.getByRole("region", { name: ruAnalytics.currentExperiment })).queryByText(
          finishedExperiment.measurement ?? "",
        ),
      ).toBeNull()
    },
  )
  it.each(["completed", "failed", "stopped"] as const)(
    "keeps the last experiment visible after %s",
    (status) => {
      renderWithLocale(
        <AnalyticsPanel
          view={{
            ...view(),
            snapshot: experimentSnapshot(
              { status },
              {
                hypotheses: [finishedExperiment],
                active_hypothesis_id: null,
              },
            ),
          }}
          onExport={vi.fn()}
        />,
      )
      expect(screen.getByText(ruMission.status[status])).toBeTruthy()
      expect(
        within(screen.getByRole("region", { name: ruAnalytics.lastExperiment })).getByText(
          finishedExperiment.prediction,
        ),
      ).toBeTruthy()
      expect(
        within(screen.getByRole("region", { name: ruAnalytics.lastExperiment })).getByText(
          finishedExperiment.measurement ?? "",
        ),
      ).toBeTruthy()
      expect(
        within(screen.getByRole("region", { name: ruAnalytics.lastExperiment })).getByText(
          finishedExperiment.conclusion ?? "",
        ),
      ).toBeTruthy()
      expect(screen.queryByText(ruAnalytics.testing)).toBeNull()
      expect(screen.queryByText(ruMission.status.idle)).toBeNull()
    },
  )
  it("preserves the known run state and forecast when the connection becomes stale", () => {
    renderWithLocale(
      <AnalyticsPanel
        view={{ ...view(), connection: "stale", snapshot: experimentSnapshot() }}
        onExport={vi.fn()}
      />,
    )
    expect(screen.getByText(ruMission.status.running)).toBeTruthy()
    expect(screen.getByText(ruAnalytics.stale)).toBeTruthy()
    expect(screen.getByText(testingExperiment.prediction)).toBeTruthy()
    expect(screen.getByText(ruAnalytics.unknown)).toBeTruthy()
    expect(screen.queryByText(ruAnalytics.testing)).toBeNull()
    expect(screen.queryByText(ruMission.status.idle)).toBeNull()
  })
  it("replaces the old result with the new run's waiting state without cached evidence", () => {
    const { rerender } = renderWithLocale(
      <AnalyticsPanel
        view={{
          ...view(),
          snapshot: experimentSnapshot(
            { status: "completed" },
            {
              hypotheses: [finishedExperiment],
              active_hypothesis_id: null,
            },
          ),
        }}
        onExport={vi.fn()}
      />,
    )
    expect(
      within(screen.getByRole("region", { name: ruAnalytics.lastExperiment })).getByText(
        finishedExperiment.prediction,
      ),
    ).toBeTruthy()
    rerender(
      <AnalyticsPanel
        view={{
          ...view(),
          snapshot: experimentSnapshot(
            { run_id: "new-run", generation: 4, status: "starting" },
            {
              hypotheses: [],
              active_hypothesis_id: null,
            },
          ),
        }}
        onExport={vi.fn()}
      />,
    )
    expect(screen.queryByText(finishedExperiment.prediction)).toBeNull()
    expect(screen.queryByText(finishedExperiment.measurement ?? "")).toBeNull()
    expect(screen.getByText(ruMission.status.starting)).toBeTruthy()
  })
})
