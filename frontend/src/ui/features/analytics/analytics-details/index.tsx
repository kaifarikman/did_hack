import { useTranslation } from "react-i18next"
import type { JournalEntry, MissionSnapshot } from "@/domain/contract"
import type { RunAnalytics } from "@/domain/runAnalytics"
import { BackendText, useFormatters } from "@/ui/shared/i18n"
import { Button, Card, Disclosure, EmptyState, Stat, VerdictMark } from "@/ui/shared/ui"
import { HypothesisObservation } from "@/ui/shared/ui/hypothesis-observation"
import styles from "./styles.module.css"

export interface AnalyticsDetailsProps {
  readonly snapshot: MissionSnapshot
  readonly analytics: RunAnalytics | null
  readonly entries: readonly JournalEntry[]
  readonly onSelectTime: (time: number | null) => void
}
export function AnalyticsDetails({
  snapshot,
  analytics,
  entries,
  onSelectTime,
}: AnalyticsDetailsProps) {
  const { t } = useTranslation("analytics")
  const format = useFormatters()
  const summary = analytics?.summary
  const hypotheses =
    snapshot.research?.hypotheses.filter((item) =>
      ["confirmed", "refuted", "unverified"].includes(item.status),
    ) ?? []
  return (
    <Card className={styles.details}>
      <Disclosure summary={t("diagnostics")}>
        {summary === undefined ? (
          <EmptyState title={t("unavailable")} />
        ) : (
          <>
            <div className={styles.stats}>
              <Stat label={t("distance")} value={format.unit(summary.distance_m, "meter", 1)} />
              <Stat label={t("simulation")} value={format.duration(summary.elapsed_sim_s)} />
              <Stat label={t("wall")} value={format.duration(summary.elapsed_wall_s)} />
              <Stat
                label={t("rtf")}
                value={
                  summary.real_time_factor === null
                    ? null
                    : format.number(summary.real_time_factor, 2)
                }
              />
              <Stat label={t("requests")} value={format.integer(summary.planner.requests)} />
              <Stat
                label={t("timeouts")}
                value={format.integer(summary.planner.deadline_timeouts)}
              />
              <Stat label={t("fallbacks")} value={format.integer(summary.planner.fallbacks)} />
              <Stat
                label={t("wait")}
                value={
                  summary.planner.last_wait_wall_s === null
                    ? null
                    : format.unit(summary.planner.last_wait_wall_s, "second", 1)
                }
              />
            </div>
            <dl className={styles.phases}>
              {summary.phase_seconds.map(([phase, seconds]) => (
                <div key={phase}>
                  <dt>{t(`phase.${phase}`)}</dt>
                  <dd>{format.duration(seconds)}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.note}>{t("phaseNote")}</p>
            <p className={styles.note}>{t("summaryNote")}</p>
          </>
        )}
      </Disclosure>
      <Disclosure summary={t("events")}>
        {entries.length === 0 ? (
          <EmptyState title={t("noEvents")} />
        ) : (
          <ul className={styles.list}>
            {entries
              .slice(-8)
              .reverse()
              .map((entry) => (
                <li key={entry.sequence} className={styles.event}>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={entry.simulation_time_s === null}
                    onClick={() => onSelectTime(entry.simulation_time_s)}
                  >
                    {entry.simulation_time_s === null
                      ? format.integer(entry.sequence)
                      : format.duration(entry.simulation_time_s)}
                  </Button>
                  <div>
                    <BackendText as="p">{entry.title}</BackendText>
                    <BackendText as="p" className={styles.note}>
                      {entry.conclusion ?? entry.detail}
                    </BackendText>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Disclosure>
      <Disclosure summary={t("history")}>
        {hypotheses.length === 0 ? (
          <EmptyState title={t("noHistory")} />
        ) : (
          <ul className={styles.list}>
            {hypotheses.slice(-8).map((hypothesis) => (
              <li key={hypothesis.hypothesis_id} className={styles.result}>
                <VerdictMark
                  verdict={
                    hypothesis.status === "confirmed"
                      ? "confirmed"
                      : hypothesis.status === "refuted"
                        ? "refuted"
                        : "inconclusive"
                  }
                  label={t(
                    hypothesis.status === "confirmed"
                      ? "confirmed"
                      : hypothesis.status === "refuted"
                        ? "refuted"
                        : "unverified",
                  )}
                />
                <span className={styles.note}>{hypothesis.hypothesis_id}</span>
                <HypothesisObservation hypothesis={hypothesis} />
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </Card>
  )
}
