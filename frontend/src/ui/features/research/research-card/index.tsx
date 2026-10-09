import type { HypothesisView, MissionSnapshot, ResearchView } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Swap, useLoadingIndicator } from "@/ui/shared/motion"
import {
  Card,
  EmptyState,
  Icon,
  Skeleton,
  StatusBadge,
  type Verdict,
  VerdictMark,
} from "@/ui/shared/ui"
import { HypothesisObservation } from "@/ui/shared/ui/hypothesis-observation"
import { hypothesisKindMessage, hypothesisStatusMessage, terrainMessage } from "../labels"
import { PlanView } from "../plan-view"
import { SensorView } from "../sensor-view"
import styles from "./styles.module.css"

export interface ResearchCardProps {
  readonly snapshot: MissionSnapshot | null
  readonly motionIndex: number
}

interface HypothesisRowProps {
  readonly hypothesis: HypothesisView
}

interface ResearchBlocksProps {
  readonly research: ResearchView
}

const VERDICTS: Readonly<Record<string, Verdict>> = {
  confirmed: "confirmed",
  refuted: "refuted",
  unverified: "inconclusive",
}

function HypothesisRow({ hypothesis }: HypothesisRowProps) {
  const text = useMessageText()
  const verdict = VERDICTS[hypothesis.status]
  const status = text(hypothesisStatusMessage(hypothesis.status))
  return (
    <li className={styles.hypothesis} data-verdict={hypothesis.status} data-motion="fade">
      <div className={styles.head}>
        <p className={styles.title}>{text(hypothesisKindMessage(hypothesis.kind))}</p>
        {verdict === undefined ? (
          <StatusBadge tone="neutral" icon="hypothesis" swapKey={hypothesis.status}>
            {status}
          </StatusBadge>
        ) : (
          <VerdictMark verdict={verdict} label={status} />
        )}
      </div>
      <HypothesisObservation hypothesis={hypothesis} />
    </li>
  )
}

function ResearchBlocks({ research }: ResearchBlocksProps) {
  const text = useMessageText()
  return (
    <>
      <Card
        as="section"
        level="inner"
        className={styles.block}
        title={text({ key: "research:label.sensor" })}
      >
        <SensorView research={research} />
        {research.last_replan_reason !== null && (
          <p className={styles.secondary}>
            <span>{text({ key: "research:label.replan" })}</span>{" "}
            <Swap swapKey={research.last_replan_reason} as="span">
              <BackendText>{research.last_replan_reason}</BackendText>
            </Swap>
          </p>
        )}
      </Card>
      <Card
        as="section"
        level="inner"
        className={styles.block}
        title={text({ key: "research:label.hazards" })}
      >
        {research.hazards.length === 0 ? (
          <EmptyState icon="hazard" title={text({ key: "research:label.noHazards" })} />
        ) : (
          <ul className={styles.list}>
            {research.hazards.map((hazard, index) => (
              <li key={hazard.detection_id} className={styles.hazard} data-motion="fade">
                <Icon name="hazard" />
                {text({
                  key: "research:label.hazardItem",
                  params: { index: index + 1, count: hazard.hits },
                })}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        as="section"
        level="inner"
        className={styles.block}
        title={text({ key: "research:label.hypotheses" })}
      >
        {research.hypotheses.length === 0 ? (
          <EmptyState icon="hypothesis" title={text({ key: "research:label.noHypotheses" })} />
        ) : (
          <ul className={styles.list}>
            {research.hypotheses.map((hypothesis) => (
              <HypothesisRow key={hypothesis.hypothesis_id} hypothesis={hypothesis} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

export function ResearchCard({ snapshot, motionIndex }: ResearchCardProps) {
  const text = useMessageText()
  const format = useFormatters()
  const loading = useLoadingIndicator({ pending: snapshot === null, hasData: false })
  const research = snapshot?.research ?? null
  return (
    <Card
      as="section"
      level="top"
      motionIndex={motionIndex}
      className={styles.card}
      title={text({ key: "research:title" })}
    >
      {loading === "skeleton" ? (
        <Skeleton lines={5} />
      ) : (
        <PlanView plan={snapshot?.plan ?? null} />
      )}
      {research !== null && <ResearchBlocks research={research} />}
      {snapshot !== null && snapshot.terrain_estimates.length > 0 && (
        <Card
          as="section"
          level="inner"
          className={styles.block}
          title={text({ key: "research:label.terrain" })}
        >
          <ul className={styles.list}>
            {snapshot.terrain_estimates.map((estimate, index) => (
              <li
                key={estimate.region_id}
                className={styles.terrain}
                data-regime={estimate.regime}
              >
                <Icon name="terrain" />
                <span>
                  {text({ key: "research:label.region", params: { index: index + 1 } })}
                </span>
                <span className={styles.number}>{text(terrainMessage(estimate, format))}</span>
                {estimate.regime > 0 && (
                  <span>
                    {text({
                      key: "research:terrain.regime",
                      params: { regime: estimate.regime },
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Card>
  )
}
