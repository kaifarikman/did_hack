import { useState } from "react"
import { useTranslation } from "react-i18next"
import { analyticsRun, runAnalytics } from "@/application/analytics"
import type { MissionViewState } from "@/application/viewState"
import type { JournalEntry, MissionSnapshot } from "@/domain/contract"
import type { RunAnalytics } from "@/domain/runAnalytics"
import { useFormatters } from "@/ui/shared/i18n"
import { Banner, Button, Card, EmptyState, Eyebrow, StatusBadge } from "@/ui/shared/ui"
import { AnalyticsDetails } from "../analytics-details"
import { HypothesisCard } from "../hypothesis-card"
import { MetricChart } from "../metric-chart"
import { OverviewStats } from "../overview-stats"
import styles from "./styles.module.css"

export interface AnalyticsPanelProps {
  readonly view: MissionViewState
  readonly onExport: (analytics: RunAnalytics) => void
}
interface RunPanelProps extends AnalyticsPanelProps {
  readonly snapshot: MissionSnapshot
  readonly entries: readonly JournalEntry[]
  readonly retained: boolean
}
function RunPanel({ view, snapshot, entries, retained, onExport }: RunPanelProps) {
  const { t } = useTranslation("analytics")
  const { t: missionText } = useTranslation("mission")
  const format = useFormatters()
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const analytics = runAnalytics(snapshot)
  const stale =
    retained ||
    view.connection !== "live" ||
    [snapshot.freshness.odom, snapshot.freshness.battery, snapshot.freshness.clock].some(
      (source) => source.fresh === false,
    )
  return (
    <div className={styles.panel}>
      <Card
        level="top"
        className={styles.heading}
        title={t("title")}
        eyebrow={t("identity", {
          robot: snapshot.robot_id,
          generation: snapshot.generation === null ? "?" : format.integer(snapshot.generation),
        })}
        actions={
          <Button
            variant="ghost"
            size="compact"
            disabled={analytics === null}
            onClick={() => analytics !== null && onExport(analytics)}
          >
            {t("export")}
          </Button>
        }
      >
        <p className={styles.subtitle}>{t("subtitle")}</p>
        {stale && <Eyebrow>{t("lastRecordedStatus")}</Eyebrow>}
        <StatusBadge tone="neutral">{missionText(`status.${snapshot.status}`)}</StatusBadge>
        {stale ? (
          <Banner tone="attention" title={t("stale")}>
            {t("staleDetail")}
          </Banner>
        ) : null}
      </Card>
      <OverviewStats snapshot={snapshot} analytics={analytics} />
      {analytics === null && (
        <Banner tone="info" title={t("unavailable")}>
          {t("unavailableDetail")}
        </Banner>
      )}
      <div className={styles.focus}>
        <HypothesisCard
          snapshot={snapshot}
          entries={entries}
          stale={stale}
          historical={retained}
        />
        <MetricChart
          analytics={analytics}
          selectedTime={selectedTime}
          onClear={() => setSelectedTime(null)}
        />
      </div>
      <AnalyticsDetails
        snapshot={snapshot}
        analytics={analytics}
        entries={entries}
        onSelectTime={setSelectedTime}
      />
    </div>
  )
}
export function AnalyticsPanel({ view, onExport }: AnalyticsPanelProps) {
  const { t } = useTranslation("analytics")
  const run = analyticsRun(view)
  if (run === null)
    return (
      <Card title={t("title")}>
        <EmptyState icon="info" title={t("empty")} description={t("emptyDetail")} />
      </Card>
    )
  return (
    <RunPanel
      key={`${run.snapshot.run_id}:${run.snapshot.robot_id}:${run.snapshot.generation}`}
      view={view}
      snapshot={run.snapshot}
      entries={run.entries}
      retained={run.retained}
      onExport={onExport}
    />
  )
}
