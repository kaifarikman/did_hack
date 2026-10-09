import type { MetricPoint } from "@/domain/runAnalytics"

export type MetricKey = "battery_remaining" | "return_energy" | "sample_signal" | "speed_mps"
export const CHART = { left: 44, right: 580, top: 16, bottom: 164, width: 600, height: 196 }
export function chartPath(
  points: readonly MetricPoint[],
  key: MetricKey,
  maximum: number,
): string {
  const start = points[0]?.simulation_time_s ?? 0
  const end = points.at(-1)?.simulation_time_s ?? start
  let penDown = false
  return points
    .map((point) => {
      const value = point[key]
      if (value === null) {
        penDown = false
        return ""
      }
      const horizontal =
        CHART.left +
        ((point.simulation_time_s - start) / Math.max(end - start, 1)) *
          (CHART.right - CHART.left)
      const vertical =
        CHART.bottom - (value / Math.max(maximum, 1e-6)) * (CHART.bottom - CHART.top)
      const command = penDown && point.continuous ? "L" : "M"
      penDown = true
      return `${command}${horizontal.toFixed(2)},${vertical.toFixed(2)}`
    })
    .join(" ")
}

export type MetricName = "energy" | "signal" | "motion"
export const METRIC_LABEL = { energy: "battery", signal: "signal", motion: "speed" } as const
const KEYS: Record<MetricName, MetricKey> = {
  energy: "battery_remaining",
  signal: "sample_signal",
  motion: "speed_mps",
}
export function chartSeries(
  history: readonly MetricPoint[],
  metric: MetricName,
  range: "recent" | "window",
  selectedTime: number | null,
) {
  const end = history.at(-1)?.simulation_time_s ?? 0
  const points =
    range === "recent"
      ? history.filter((point) => point.simulation_time_s >= end - 30)
      : history
  const start = points[0]?.simulation_time_s ?? end
  const key = KEYS[metric]
  const values = points.map((point) =>
    Math.max(point[key] ?? 0, metric === "energy" ? (point.return_energy ?? 0) : 0),
  )
  const maximum = metric === "signal" ? 1 : Math.max(metric === "energy" ? 1 : 0.15, ...values)
  const marker =
    selectedTime !== null && selectedTime >= start && selectedTime <= end
      ? CHART.left +
        ((selectedTime - start) / Math.max(end - start, 1)) * (CHART.right - CHART.left)
      : null
  return { points, start, end, key, maximum, marker }
}
