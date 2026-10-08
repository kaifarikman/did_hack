import type { TeamOutcome, TeamView } from "@/domain/contract"
import type { MessageKey } from "@/domain/message"

export type TeamKey = Extract<MessageKey, `team:${string}`>
export type TeamTone = "neutral" | "progress" | "positive" | "attention" | "critical"

export const TEAM_OUTCOME_LABELS: Readonly<Record<TeamOutcome, TeamKey>> = {
  running: "team:outcome.running",
  success: "team:outcome.success",
  partial: "team:outcome.partial",
  failed: "team:outcome.failed",
  stopped: "team:outcome.stopped",
}

export const TEAM_OUTCOME_TONES: Readonly<Record<TeamOutcome, TeamTone>> = {
  running: "progress",
  success: "positive",
  partial: "attention",
  failed: "critical",
  stopped: "attention",
}

export interface TeamBadge {
  readonly key: TeamKey
  readonly tone: TeamTone
  readonly swapKey: string
}

export function teamBadge(team: TeamView): TeamBadge {
  if (team.outcome === "running" && team.lost_robots.length > 0)
    return { key: "team:outcome.runningAlone", tone: "attention", swapKey: "running-alone" }
  return {
    key: TEAM_OUTCOME_LABELS[team.outcome],
    tone: TEAM_OUTCOME_TONES[team.outcome],
    swapKey: team.outcome,
  }
}

export function coordinationLabel(team: TeamView): TeamKey {
  return team.coordinated ? "team:coordination.on" : "team:coordination.off"
}

export function isTeamVisible(team: TeamView | null): team is TeamView {
  return team !== null && team.robots.length > 1
}
