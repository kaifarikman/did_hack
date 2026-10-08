import type { MissionSnapshot, TeamOutcome } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Card, Icon, type IconName, Stat } from "@/ui/shared/ui"
import { batteryMessage, outcomeOf } from "../format"
import {
  METRIC_LABELS,
  type MissionKey,
  OUTCOME_LABELS,
  type OutcomeKind,
  TEAM_OUTCOME_LABELS,
} from "../labels"
import styles from "./styles.module.css"

export interface RunSummaryProps {
  readonly snapshot: MissionSnapshot
}

const OUTCOME_ICONS: Readonly<Record<OutcomeKind, IconName>> = {
  success: "confirmed",
  interrupted: "stop",
  failure: "critical",
}

const TEAM_OUTCOME_KINDS: Readonly<Record<TeamOutcome, OutcomeKind>> = {
  running: "interrupted",
  success: "success",
  partial: "interrupted",
  failed: "failure",
  stopped: "interrupted",
}

interface SummaryOutcome {
  readonly kind: OutcomeKind
  readonly label: MissionKey
  readonly team: boolean
}

function summaryOutcome(snapshot: MissionSnapshot): SummaryOutcome | null {
  const outcome = outcomeOf(snapshot.status)
  if (outcome === null) return null
  const team = snapshot.team
  if (team === null || team.robots.length < 2)
    return { kind: outcome, label: OUTCOME_LABELS[outcome], team: false }
  return {
    kind: TEAM_OUTCOME_KINDS[team.outcome],
    label: TEAM_OUTCOME_LABELS[team.outcome],
    team: true,
  }
}

function countHypotheses(snapshot: MissionSnapshot, status: string): number {
  return snapshot.research?.hypotheses.filter((item) => item.status === status).length ?? 0
}

export function RunSummary({ snapshot }: RunSummaryProps) {
  const text = useMessageText()
  const format = useFormatters()
  const outcome = summaryOutcome(snapshot)
  if (outcome === null) return null
  return (
    <Card
      level="inner"
      as="article"
      className={styles.summary}
      data-motion="fade"
      data-outcome={outcome.kind}
      data-team={outcome.team}
      title={text({ key: "mission:summary.title" })}
    >
      <p className={styles.outcome}>
        <Icon name={OUTCOME_ICONS[outcome.kind]} />
        <span>{text({ key: outcome.label })}</span>
      </p>
      <div className={styles.grid}>
        <Stat
          label={text({ key: METRIC_LABELS.samples })}
          value={format.integer(snapshot.samples_collected)}
          icon="sample"
        />
        <Stat
          label={text({ key: METRIC_LABELS.battery })}
          value={text(
            batteryMessage(snapshot.battery_remaining, snapshot.battery_initial, format),
          )}
          icon="battery"
          className={styles.wide}
        />
        <Stat
          label={text({ key: "mission:summary.confirmed" })}
          value={format.integer(countHypotheses(snapshot, "confirmed"))}
          icon="confirmed"
        />
        <Stat
          label={text({ key: "mission:summary.refuted" })}
          value={format.integer(countHypotheses(snapshot, "refuted"))}
          icon="refuted"
        />
      </div>
      {snapshot.last_error !== null && (
        <p className={styles.reason} data-retryable={snapshot.last_error.retryable}>
          <span>{text({ key: "mission:summary.reason" })}</span>
          <BackendText>{snapshot.last_error.message}</BackendText>
          <span className={styles.retry}>
            {text({
              key: snapshot.last_error.retryable
                ? "mission:summary.retryable"
                : "mission:summary.final",
            })}
          </span>
        </p>
      )}
    </Card>
  )
}
