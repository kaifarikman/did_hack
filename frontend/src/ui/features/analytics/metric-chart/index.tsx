import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import type { RunAnalytics } from "@/domain/runAnalytics"
import { useFormatters } from "@/ui/shared/i18n"
import { Button, Card, EmptyState, Segmented } from "@/ui/shared/ui"
import { CHART, chartPath, chartSeries, METRIC_LABEL, type MetricName } from "./geometry"
import styles from "./styles.module.css"

export interface MetricChartProps {
  readonly analytics: RunAnalytics | null
  readonly selectedTime: number | null
  readonly onClear: () => void
}
export function MetricChart({ analytics, selectedTime, onClear }: MetricChartProps) {
  const { t } = useTranslation("analytics")
  const format = useFormatters()
  const titleId = useId()
  const [metric, setMetric] = useState<MetricName>("energy")
  const [range, setRange] = useState<"window" | "recent">("window")
  const { points, start, end, key, maximum, marker } = chartSeries(
    analytics?.history ?? [],
    metric,
    range,
    selectedTime,
  )
  return (
    <Card title={t("chart")} className={styles.card}>
      <div className={styles.controls}>
        <Segmented
          label={t("metric")}
          size="compact"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "energy", label: t("energy") },
            { value: "signal", label: t("signal") },
            { value: "motion", label: t("motion") },
          ]}
        />
        <Segmented
          label={t("range")}
          size="compact"
          value={range}
          onChange={setRange}
          options={[
            { value: "window", label: t("window") },
            { value: "recent", label: t("recent") },
          ]}
        />
      </div>
      {points.length < 2 ? (
        <EmptyState icon="info" title={t("chartEmpty")} />
      ) : (
        <>
          <svg
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            className={styles.chart}
            role="img"
            aria-labelledby={titleId}
          >
            <title id={titleId}>{t(metric)}</title>
            {[0, 0.5, 1].map((ratio) => (
              <g key={ratio}>
                <line
                  x1={CHART.left}
                  x2={CHART.right}
                  y1={CHART.bottom - ratio * (CHART.bottom - CHART.top)}
                  y2={CHART.bottom - ratio * (CHART.bottom - CHART.top)}
                  className={styles.grid}
                />
                <text
                  x={CHART.left - 8}
                  y={CHART.bottom - ratio * (CHART.bottom - CHART.top) + 4}
                  textAnchor="end"
                >
                  {format.number(maximum * ratio, metric === "energy" ? 0 : 2)}
                </text>
              </g>
            ))}
            <path d={chartPath(points, key, maximum)} className={styles.primary} />
            {metric === "energy" && (
              <path d={chartPath(points, "return_energy", maximum)} className={styles.return} />
            )}
            {marker !== null && (
              <line
                x1={marker}
                x2={marker}
                y1={CHART.top}
                y2={CHART.bottom}
                className={styles.marker}
              />
            )}
            <text x={CHART.left} y={190}>
              {format.duration(start)}
            </text>
            <text x={CHART.right} y={190} textAnchor="end">
              {format.duration(end)}
            </text>
          </svg>
          <div className={styles.legend}>
            <span>{t(METRIC_LABEL[metric])}</span>
            {metric === "energy" && <span className={styles.returnLabel}>{t("return")}</span>}
            {metric !== "signal" && (
              <span>{t(metric === "motion" ? "speedUnit" : "energyUnit")}</span>
            )}
          </div>
        </>
      )}
      {selectedTime !== null && (
        <div className={styles.selection}>
          <span>{t("selectedEvent", { time: format.duration(selectedTime) })}</span>
          <Button variant="ghost" size="compact" onClick={onClear}>
            {t("clearSelection")}
          </Button>
        </div>
      )}
      <p className={styles.note}>
        {t("chartNote", { count: analytics?.history_limit ?? 180 })}
      </p>
    </Card>
  )
}
