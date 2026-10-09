import { useTranslation } from "react-i18next"
import type { HypothesisView } from "@/domain/contract"
import { BackendText, useFormatters } from "../../i18n"
import { Disclosure } from "../disclosure"
import { Eyebrow } from "../eyebrow"
import { Stat } from "../stat"
import styles from "./styles.module.css"

export interface HypothesisObservationProps {
  readonly hypothesis: HypothesisView
  readonly experimentActive?: boolean
}

export function HypothesisObservation({
  hypothesis,
  experimentActive = true,
}: HypothesisObservationProps) {
  const { t } = useTranslation("research")
  const format = useFormatters()
  const signal = hypothesis.kind === "sample_signal"
  const pending = ["proposed", "testing", "deferred"].includes(hypothesis.status)
  const measurement = pending ? null : hypothesis.measurement
  const conclusion = pending ? null : hypothesis.conclusion
  const signalNumber = (value: number | null | undefined) =>
    value == null ? null : format.number(value, 2)
  return (
    <div className={styles.observation}>
      <div className={styles.readings}>
        <div>
          <Eyebrow>{t("experiment.prediction")}</Eyebrow>
          <BackendText as="p">{hypothesis.prediction}</BackendText>
        </div>
        {hypothesis.action != null && (
          <div>
            <Eyebrow>{t("experiment.action")}</Eyebrow>
            <BackendText as="p">{hypothesis.action}</BackendText>
          </div>
        )}
        <div>
          <Eyebrow>{t("experiment.measurement")}</Eyebrow>
          {measurement === null ? (
            <p className={styles.note}>
              {t(pending && experimentActive ? "experiment.pending" : "experiment.missing")}
            </p>
          ) : (
            <BackendText as="p">{measurement}</BackendText>
          )}
        </div>
        {conclusion != null && (
          <div>
            <Eyebrow>{t("experiment.conclusion")}</Eyebrow>
            <BackendText as="p">{conclusion}</BackendText>
          </div>
        )}
      </div>
      {signal && (
        <Disclosure summary={t("experiment.signalEvidence")}>
          <div className={styles.stats}>
            <Stat
              label={t("experiment.forecastSignal")}
              value={signalNumber(hypothesis.expected_signal)}
            />
            <Stat
              label={t("experiment.measuredSignal")}
              value={pending ? null : signalNumber(hypothesis.measured_signal)}
            />
            <Stat
              label={t("experiment.baselineSignal")}
              value={signalNumber(hypothesis.baseline_signal)}
            />
            <Stat
              label={t("experiment.measurementCount")}
              value={format.integer(pending ? 0 : (hypothesis.measurement_count ?? 0))}
            />
          </div>
          <p className={styles.note}>{t("experiment.signalNote")}</p>
        </Disclosure>
      )}
    </div>
  )
}
