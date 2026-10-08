import type { MissionController } from "@/application/missionController"
import type { MissionViewState } from "@/application/viewState"
import { useMessageText } from "@/ui/shared/i18n"
import { useLoadingIndicator } from "@/ui/shared/motion"
import { Card, Skeleton, StatusBadge } from "@/ui/shared/ui"
import { CommandBanner } from "../command-banner"
import { JUDGE_LABELS, MAP_MODE_LABELS, PLANNER_LABELS, SCENARIO_LABELS } from "../labels"
import { useMissionLayout } from "../layout"
import { MissionForm } from "../mission-form"
import { MissionStats } from "../mission-stats"
import { RunSummary } from "../run-summary"
import styles from "./styles.module.css"

export interface MissionCardProps {
  readonly view: MissionViewState
  readonly controller: MissionController
  readonly motionIndex: number
}

export function MissionCard({ view, controller, motionIndex }: MissionCardProps) {
  const text = useMessageText()
  const snapshot = view.snapshot
  const layout = useMissionLayout(snapshot)
  const loading = useLoadingIndicator({ pending: snapshot === null, hasData: false })
  return (
    <Card
      as="section"
      level="top"
      motionIndex={motionIndex}
      className={styles.card}
      data-layout={layout}
      title={text({ key: "mission:title" })}
      actions={
        snapshot === null ? undefined : (
          <>
            <StatusBadge
              tone="neutral"
              icon={snapshot.planner_mode === "llm" ? "llm" : "fallback"}
              swapKey={snapshot.planner_mode}
            >
              {text({ key: PLANNER_LABELS[snapshot.planner_mode] })}
            </StatusBadge>
            <StatusBadge tone="neutral" swapKey={snapshot.judge_mode}>
              {text({ key: JUDGE_LABELS[snapshot.judge_mode] })}
            </StatusBadge>
          </>
        )
      }
    >
      <MissionForm
        view={view}
        className={styles.form}
        compact={layout === "run"}
        lead={
          <>
            {snapshot !== null &&
              snapshot.run_id !== null &&
              snapshot.scenario !== null &&
              snapshot.seed !== null && (
                <p className={styles.parameters}>
                  {text({
                    key: "mission:form.runParameters",
                    params: {
                      scenario: text({ key: SCENARIO_LABELS[snapshot.scenario] }),
                      mapMode: text({ key: MAP_MODE_LABELS[snapshot.map_mode] }),
                      seed: snapshot.seed,
                    },
                  })}
                </p>
              )}
            {loading === "skeleton" ? (
              <Skeleton lines={4} />
            ) : (
              snapshot !== null && <MissionStats snapshot={snapshot} />
            )}
            {snapshot !== null && layout === "summary" && <RunSummary snapshot={snapshot} />}
          </>
        }
        notice={<CommandBanner command={view.command} controller={controller} />}
        onStop={() => void controller.stopRun()}
        onStart={(request) =>
          void controller.startRun(
            request.seed,
            request.scenario,
            request.missionText,
            request.mapMode,
            request.robotCount,
          )
        }
      />
    </Card>
  )
}
