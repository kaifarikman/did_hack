import type { ResearchView } from "@/domain/contract"
import { useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Stat, StatusBadge } from "@/ui/shared/ui"
import { sensorLabels } from "../labels"
import styles from "./styles.module.css"

export interface SensorViewProps {
  readonly research: ResearchView
}

export function SensorView({ research }: SensorViewProps) {
  const text = useMessageText()
  const format = useFormatters()
  const { sensor } = research
  const labels = sensorLabels(sensor.state, sensor.fault)
  return (
    <div className={styles.sensor} data-state={sensor.state}>
      <div className={styles.state}>
        <StatusBadge
          tone={labels.tone}
          icon="sensor"
          swapKey={`${sensor.state}:${sensor.fault ?? "none"}`}
        >
          {text({ key: labels.state })}
        </StatusBadge>
        <span className={styles.fault} data-fault={sensor.fault ?? "none"}>
          {labels.fault === null ? null : text({ key: labels.fault })}
        </span>
      </div>
      <Stat
        label={text({ key: "research:label.quality" })}
        value={format.percent(sensor.quality)}
      />
      <Stat
        label={text({ key: "research:label.plannerRequests" })}
        value={format.integer(research.planner_requests)}
        icon="plan"
      />
    </div>
  )
}
