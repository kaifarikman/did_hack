import { useTranslation } from "react-i18next"
import { experimentView, hypothesisEvidence } from "@/application/analytics"
import type { JournalEntry, MissionSnapshot } from "@/domain/contract"
import { isActiveStatus } from "@/domain/status"
import { BackendText } from "@/ui/shared/i18n"
import { Card, Disclosure, EmptyState, Eyebrow, StatusBadge } from "@/ui/shared/ui"
import { HypothesisObservation } from "@/ui/shared/ui/hypothesis-observation"
import { experimentLabels, hypothesisStatement } from "./labels"
import styles from "./styles.module.css"

export interface HypothesisCardProps {
  readonly snapshot: MissionSnapshot
  readonly entries: readonly JournalEntry[]
  readonly stale: boolean
  readonly historical?: boolean
}
export function HypothesisCard({
  snapshot,
  entries,
  stale,
  historical = false,
}: HypothesisCardProps) {
  const { t } = useTranslation("analytics")
  const experiment = experimentView(snapshot, entries, historical)
  const hypothesis = experiment.hypothesis
  const active = experiment.phase === "active"
  const labels = experimentLabels(experiment, stale)
  const waiting = !historical && isActiveStatus(snapshot.status)
  return (
    <Card
      level="top"
      title={t(labels.title)}
      className={styles.card}
      actions={
        hypothesis === null ? undefined : (
          <StatusBadge tone="neutral" icon="hypothesis">
            {t(labels.status)}
          </StatusBadge>
        )
      }
    >
      {hypothesis === null ? (
        <>
          <EmptyState
            icon="hypothesis"
            title={t(waiting ? "waitingExperiment" : "noExperiment")}
            description={t(waiting ? "waitingExperimentDetail" : "noExperimentDetail")}
          />
          {waiting && snapshot.current_goal !== null && (
            <div className={styles.action}>
              <Eyebrow>{t("currentAction")}</Eyebrow>
              <BackendText as="p">{snapshot.current_goal.reason}</BackendText>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={styles.statement}>{t(hypothesisStatement(hypothesis.kind))}</p>
          <HypothesisObservation hypothesis={hypothesis} experimentActive={active} />
          <p className={styles.secondary}>{t(labels.note)}</p>
          <Disclosure summary={t("evidence")}>
            <p className={styles.secondary}>{hypothesis.hypothesis_id}</p>
            {hypothesisEvidence(hypothesis, entries).map((entry) => (
              <div key={entry.sequence} className={styles.evidence}>
                <BackendText as="p">{entry.title}</BackendText>
                <BackendText as="p" className={styles.secondary}>
                  {entry.detail}
                </BackendText>
              </div>
            ))}
          </Disclosure>
        </>
      )}
    </Card>
  )
}
