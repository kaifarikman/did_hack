import { useTranslation } from "react-i18next"
import type { MissionSnapshot } from "@/domain/contract"
import type { RunAnalytics } from "@/domain/runAnalytics"
import { useFormatters } from "@/ui/shared/i18n"
import { Card, Stat } from "@/ui/shared/ui"
import styles from "./styles.module.css"

export interface OverviewStatsProps {
  readonly snapshot: MissionSnapshot
  readonly analytics: RunAnalytics | null
}
export function OverviewStats({ snapshot, analytics }: OverviewStatsProps) {
  const { t } = useTranslation("analytics")
  const format = useFormatters()
  const number = (value: number | null | undefined) =>
    value == null ? null : format.number(value)
  return (
    <Card level="top" className={styles.stats}>
      <Stat
        label={t("battery")}
        value={number(snapshot.battery_remaining)}
        unit={t("energyUnit")}
      />
      <Stat
        label={t("available")}
        value={number(analytics?.summary.available_energy)}
        unit={t("energyUnit")}
        tone={(analytics?.summary.available_energy ?? 1) < 0 ? "attention" : "default"}
      />
      <Stat
        label={t("speed")}
        value={
          analytics?.summary.speed_mps == null
            ? null
            : format.number(analytics.summary.speed_mps, 2)
        }
        unit={t("speedUnit")}
      />
      <Stat label={t("samples")} value={format.integer(snapshot.samples_collected)} />
    </Card>
  )
}
