import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { HypothesisView } from "@/domain/contract"
import { readHypothesis } from "@/domain/parsing/hypothesis"
import { HypothesisCard } from "@/ui/features/analytics/hypothesis-card"
import { ResearchCard } from "@/ui/features/research/research-card"
import analytics from "@/ui/shared/i18n/locales/ru/analytics.json"
import research from "@/ui/shared/i18n/locales/ru/research.json"
import { HypothesisObservation } from "@/ui/shared/ui/hypothesis-observation"
import { snapshotWith } from "../../support"
import { renderWithLocale } from "./render"

const sample: HypothesisView = {
  hypothesis_id: "sample-test",
  kind: "sample_signal",
  status: "confirmed",
  center: { position_x_m: 1, position_y_m: 2 },
  prediction: "Signal should reach 0.60 near the target.",
  measurement: "Median of three independent readings: 0.64.",
  detection_id: null,
  experiment_id: "sample-experiment",
  expected_signal: 0.6,
  measured_signal: 0.64,
  baseline_signal: 0.2,
  measurement_count: 3,
  action: "Move to the target and take fresh readings.",
  conclusion: "Measured signal agrees with the forecast.",
}
const sampleRun = (hypothesis: HypothesisView) =>
  snapshotWith({
    research: {
      sensor: { state: "ok", fault: null, quality: 1 },
      hazards: [],
      hypotheses: [hypothesis],
      active_hypothesis_id: hypothesis.hypothesis_id,
      planner_requests: 1,
      last_replan_reason: null,
      last_replan_detection_id: null,
    },
  })

describe("sample signal hypothesis", () => {
  it("parses normalized measurements and rejects invalid signal and counts", () => {
    expect(readHypothesis(sample, "hypothesis")).toMatchObject(sample)
    for (const patch of [
      { expected_signal: 1.1 },
      { measured_signal: -0.1 },
      { baseline_signal: Number.NaN },
      { measurement_count: 1.5 },
    ]) {
      expect(() => readHypothesis({ ...sample, ...patch }, "hypothesis")).toThrow()
    }
    const { expected_signal: omitted, ...legacy } = sample
    expect(omitted).toBe(0.6)
    expect(
      readHypothesis({ ...legacy, kind: "costly_terrain" }, "hypothesis").expected_signal,
    ).toBeNull()
  })
  it("shows the full scientific chain and keeps numeric evidence collapsed", () => {
    const { container } = renderWithLocale(<HypothesisObservation hypothesis={sample} />)
    expect(screen.getByText(sample.prediction)).toBeTruthy()
    expect(screen.getByText(sample.action ?? "")).toBeTruthy()
    expect(screen.getByText(sample.measurement ?? "")).toBeTruthy()
    expect(screen.getByText(sample.conclusion ?? "")).toBeTruthy()
    expect(container.querySelectorAll("details[open]")).toHaveLength(0)
    expect(screen.getByText("0,64")).toBeTruthy()
    expect(screen.getByText(research.experiment.signalNote)).toBeTruthy()
    expect(container.textContent).not.toContain("units/m")
  })
  it("never presents an earlier attempt measurement while testing", () => {
    renderWithLocale(<HypothesisObservation hypothesis={{ ...sample, status: "testing" }} />)
    expect(screen.getByText(research.experiment.pending)).toBeTruthy()
    expect(screen.queryByText(sample.measurement ?? "")).toBeNull()
    expect(screen.queryByText(sample.conclusion ?? "")).toBeNull()
    expect(screen.queryByText("0,64")).toBeNull()
  })
  it("keeps insufficient evidence distinct from a refuted prediction", () => {
    const uncertain = {
      ...sample,
      status: "unverified",
      measured_signal: null,
      measurement: null,
      conclusion: "Fresh readings were unavailable.",
    }
    renderWithLocale(<ResearchCard snapshot={sampleRun(uncertain)} motionIndex={0} />)
    expect(screen.getByText(research.hypothesis.unverified)).toBeTruthy()
    expect(screen.getByText(research.experiment.missing)).toBeTruthy()
    expect(screen.getByText(uncertain.conclusion)).toBeTruthy()
    expect(screen.queryByText(research.hypothesis.refuted)).toBeNull()
  })
  it("names sample science correctly in the active dashboard and marks stale state unknown", () => {
    renderWithLocale(
      <HypothesisCard
        snapshot={sampleRun({ ...sample, status: "testing" })}
        entries={[]}
        stale
      />,
    )
    expect(screen.getByText(analytics.sampleSignal)).toBeTruthy()
    expect(screen.getByText(analytics.unknown)).toBeTruthy()
    expect(screen.queryByText(analytics.costly)).toBeNull()
  })
  it("retains terrain predictions without inventing signal evidence", () => {
    renderWithLocale(
      <HypothesisObservation hypothesis={{ ...sample, kind: "costly_terrain" }} />,
    )
    expect(screen.getByText(sample.prediction)).toBeTruthy()
    expect(screen.queryByText(research.experiment.signalEvidence)).toBeNull()
  })
})
