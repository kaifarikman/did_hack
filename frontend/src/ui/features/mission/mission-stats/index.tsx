import type { MissionSnapshot } from "@/domain/contract"
import { isFinishedStatus } from "@/domain/status"
import { useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Meter, Stat, StatusBadge } from "@/ui/shared/ui"
import {
  batteryMessage,
  batteryRatio,
  energyMessage,
  isBelowReturnReserve,
  reserveRatio,
  samplesMessage,
  signalText,
  simulationTimeText,
} from "../format"
import {
  GOAL_LABELS,
  METRIC_LABELS,
  NO_GOAL_LABEL,
  STATUS_LABELS,
  STATUS_TONES,
} from "../labels"
import styles from "./styles.module.css"

export interface MissionStatsProps {
  readonly snapshot: MissionSnapshot
}

const LIVE_STATUSES = new Set(["starting", "running", "returning"])

export function MissionStats({ snapshot }: MissionStatsProps) {
  const text = useMessageText()
  const format = useFormatters()
  const lowBattery = isBelowReturnReserve(snapshot)
  const energy = energyMessage(snapshot.return_energy_estimate, format)
  const goal = snapshot.current_goal
  const reserve = reserveRatio(snapshot)
  const thresholdProps =
    reserve === null
      ? {}
      : { threshold: reserve, thresholdLabel: text({ key: "mission:value.reserve" }) }
  return (
    <div className={styles.stats}>
      <div className={styles.status} role="status">
        <StatusBadge
          tone={STATUS_TONES[snapshot.status]}
          live={LIVE_STATUSES.has(snapshot.status)}
          swapKey={snapshot.status}
        >
          {text({ key: STATUS_LABELS[snapshot.status] })}
        </StatusBadge>
      </div>
      <Meter
        className={styles.battery}
        label={text({ key: METRIC_LABELS.battery })}
        value={batteryRatio(snapshot.battery_remaining, snapshot.battery_initial)}
        valueText={text(
          batteryMessage(snapshot.battery_remaining, snapshot.battery_initial, format),
        )}
        {...thresholdProps}
        tone={lowBattery ? "attention" : "default"}
      />
      <Stat
        label={text({ key: METRIC_LABELS.time })}
        value={simulationTimeText(snapshot.simulation_time_s, format)}
        icon="clock"
      />
      <Stat
        label={text({ key: METRIC_LABELS.signal })}
        value={signalText(snapshot.sample_signal, format)}
        icon="signal"
      />
      <Stat
        label={text({ key: METRIC_LABELS.samples })}
        value={text(
          samplesMessage(snapshot.samples_collected, snapshot.target_samples, format),
        )}
        icon="sample"
      />
      <Stat
        label={text({ key: METRIC_LABELS.returnEstimate })}
        value={energy === null ? null : text(energy)}
        tone={lowBattery ? "attention" : "default"}
        icon="home"
      />
      {!(goal === null && isFinishedStatus(snapshot.status)) && (
        <Stat
          label={text({ key: METRIC_LABELS.goal })}
          value={text({ key: goal === null ? NO_GOAL_LABEL : GOAL_LABELS[goal.kind] })}
          icon="target"
        />
      )}
    </div>
  )
}
