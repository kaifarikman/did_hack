import { clsx } from "clsx"
import { type CSSProperties, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export type MeterTone = "default" | "attention" | "critical"

export interface MeterProps {
  readonly label: string
  readonly value: number | null
  readonly valueText: string
  readonly threshold?: number
  readonly thresholdLabel?: string
  readonly tone?: MeterTone
  readonly className?: string | undefined
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function Meter({
  label,
  value,
  valueText,
  threshold,
  thresholdLabel,
  tone = "default",
  className,
}: MeterProps) {
  const { t } = useTranslation()
  const labelId = useId()
  const [flash, setFlash] = useState({ tone, count: 0 })
  if (flash.tone !== tone) {
    setFlash({ tone, count: tone === "default" ? flash.count : flash.count + 1 })
  }
  const ratio = value === null ? 0 : clampRatio(value)
  const fillStyle = { "--meter-value": ratio } as CSSProperties
  const thresholdStyle =
    threshold === undefined
      ? undefined
      : ({ "--meter-threshold": clampRatio(threshold) } as CSSProperties)

  return (
    <div className={clsx(styles.meter, className)} data-tone={tone}>
      <div className={styles.header}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        <span className={styles.reading}>
          {tone === "default" ? null : (
            <Icon
              name={tone === "critical" ? "critical" : "alert"}
              size="sm"
              className={styles.icon}
            />
          )}
          {valueText}
        </span>
      </div>
      <meter
        className="visually-hidden"
        aria-labelledby={labelId}
        aria-valuetext={valueText}
        min={0}
        max={1}
        value={ratio}
      />
      <div className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={fillStyle} />
        {flash.count > 0 ? <span key={flash.count} className={styles.flash} /> : null}
        {thresholdStyle === undefined ? null : (
          <span
            className={styles.threshold}
            style={thresholdStyle}
            title={thresholdLabel ?? t("meter.threshold")}
          />
        )}
      </div>
    </div>
  )
}
