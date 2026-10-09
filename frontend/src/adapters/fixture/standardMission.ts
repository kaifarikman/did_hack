import type {
  GoalKind,
  HypothesisView,
  MissionPlanView,
  MissionSnapshot,
  ResearchView,
  StepStatus,
} from "../../domain/contract"
import { exampleEntries, missionEntry, missionError, timed } from "./baseline"
import { hypothesesFrom, planFrom } from "./content"
import standardContent from "./examples/content/standard.json"
import type { ScriptedJournalEntry } from "./script"
import {
  buildMissionTimeline,
  type FrameOverlay,
  type MissionTimeline,
  overlay,
  type TimelineMarks,
  type TimelineOptions,
} from "./timeline"

interface StandardOptions {
  llmFailsAtFrame: number | null
  timeline: Partial<TimelineOptions>
}

interface StandardMission {
  timeline: MissionTimeline
  frames: MissionSnapshot[]
  journal: ScriptedJournalEntry[]
}

const STEP_ORDER: readonly GoalKind[] = ["explore", "approach", "collect", "return"]
const LLM_ERROR_FRAMES = 4
const HYPOTHESIS_PROPOSED_AT = 16
const HYPOTHESIS_TESTING_AT = 18
const COMPARISON_DONE_AT = 22
const HYPOTHESIS_VERDICT_AT = 24

const LLM_PLAN: MissionPlanView = planFrom(standardContent.llmPlan)
const FALLBACK_PLAN: MissionPlanView = planFrom(standardContent.fallbackPlan)

const [COSTLY_PROPOSED, COSTLY_TESTING, COSTLY_CONFIRMED, RETURN_PROPOSED] = hypothesesFrom([
  standardContent.hypotheses.costlyProposed,
  standardContent.hypotheses.costlyTesting,
  standardContent.hypotheses.costlyConfirmed,
  standardContent.hypotheses.returnProposed,
])

function stepStatus(
  scripted: StepStatus,
  stepIndex: number,
  activeIndex: number,
  finished: boolean,
): StepStatus {
  if (scripted !== "pending") return scripted
  if (finished || stepIndex < activeIndex) return "done"
  return stepIndex === activeIndex ? "active" : "pending"
}

export function progressPlan(plan: MissionPlanView, frame: MissionSnapshot): MissionPlanView {
  const goal = frame.current_goal?.kind ?? null
  const activeIndex = goal === null ? -1 : STEP_ORDER.indexOf(goal)
  const finished = frame.status === "completed"
  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      status: stepStatus(step.status, STEP_ORDER.indexOf(step.kind), activeIndex, finished),
    })),
  }
}

export function standardHypotheses(index: number, marks: TimelineMarks): HypothesisView[] {
  const costly =
    index >= HYPOTHESIS_VERDICT_AT
      ? COSTLY_CONFIRMED
      : index >= HYPOTHESIS_TESTING_AT
        ? COSTLY_TESTING
        : index >= HYPOTHESIS_PROPOSED_AT
          ? COSTLY_PROPOSED
          : undefined
  const returning = index >= marks.returnStart + 3 ? RETURN_PROPOSED : undefined
  return [costly, returning].filter((item): item is HypothesisView => item !== undefined)
}

function standardResearch(index: number, marks: TimelineMarks): ResearchView {
  return {
    sensor: { state: "ok", fault: null, quality: 1 },
    hazards: [],
    hypotheses: standardHypotheses(index, marks),
    active_hypothesis_id:
      standardHypotheses(index, marks).find((item) => item.status === "testing")
        ?.hypothesis_id ?? null,
    last_replan_reason: null,
    last_replan_detection_id: null,
    planner_requests:
      1 + (index >= marks.collectStart ? 1 : 0) + (index >= marks.returnStart ? 1 : 0),
  }
}

function planLayer(llmFailsAtFrame: number | null): FrameOverlay {
  return (frame, index) => {
    if (index === 0) return { plan: null }
    const failed = llmFailsAtFrame !== null && index >= llmFailsAtFrame
    const showError = failed && index < (llmFailsAtFrame ?? 0) + LLM_ERROR_FRAMES
    return {
      planner_mode: failed ? "fallback" : "llm",
      plan: progressPlan(failed ? FALLBACK_PLAN : LLM_PLAN, frame),
      last_error: showError ? missionError("llmTimeout") : frame.last_error,
    }
  }
}

const researchLayer: FrameOverlay = (_frame, index, marks) => ({
  research: index === 0 ? null : standardResearch(index, marks),
})

function standardJournal(
  llmFailsAtFrame: number | null,
  marks: TimelineMarks,
  failed: boolean,
) {
  const [start, hypothesis, experiment] = exampleEntries
  const entries: ScriptedJournalEntry[] = []
  if (start !== undefined) entries.push({ atFrame: 0, entry: start })
  if (hypothesis !== undefined)
    entries.push({ atFrame: HYPOTHESIS_PROPOSED_AT, entry: hypothesis })
  if (experiment !== undefined)
    entries.push({ atFrame: HYPOTHESIS_TESTING_AT, entry: experiment })
  if (llmFailsAtFrame !== null) entries.push(timed(llmFailsAtFrame, missionEntry("llmFailed")))
  entries.push(
    timed(COMPARISON_DONE_AT, missionEntry("comparisonDone")),
    timed(HYPOTHESIS_VERDICT_AT, missionEntry("hypothesisVerdict")),
    timed(marks.collectStart + 2, missionEntry("collectConfirmed")),
    timed(marks.returnStart + 1, missionEntry("returnDecision")),
    timed(marks.returnStart + 3, missionEntry("returnHypothesis")),
    timed(marks.finalIndex, missionEntry(failed ? "rosLost" : "completed")),
  )
  return entries
}

export function standardMission(options: Partial<StandardOptions> = {}): StandardMission {
  const llmFailsAtFrame = options.llmFailsAtFrame ?? null
  const timelineOptions = options.timeline ?? {}
  const timeline = buildMissionTimeline(timelineOptions)
  const failed = (timelineOptions.failAtReturnStep ?? null) !== null
  return {
    timeline,
    frames: overlay(timeline, planLayer(llmFailsAtFrame), researchLayer),
    journal: standardJournal(llmFailsAtFrame, timeline.marks, failed),
  }
}
