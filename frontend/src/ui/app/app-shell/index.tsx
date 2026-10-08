import { useState } from "react"
import {
  DEFAULT_FIXTURE_SCENARIO,
  FIXTURE_SCENARIOS,
  type FixtureScenarioName,
} from "@/adapters/fixture/catalog"
import type { FixtureControls } from "@/adapters/fixture/fixtureGateway"
import type { MissionController } from "@/application/missionController"
import { navigationStartDisabledReason } from "@/application/navigation"
import type { MissionViewState } from "@/application/viewState"
import type { TeamRobotView } from "@/domain/contract"
import { DemoPicker } from "@/ui/features/demo/demo-picker"
import { JournalCard } from "@/ui/features/journal/journal-card"
import { LocaleSwitch } from "@/ui/features/locale-switch"
import { MapCard } from "@/ui/features/map/map-card"
import { GOAL_LABELS, STATUS_LABELS } from "@/ui/features/mission/labels"
import { MissionCard } from "@/ui/features/mission/mission-card"
import { NavigationFields } from "@/ui/features/mission/navigation-fields"
import { ResearchCard } from "@/ui/features/research/research-card"
import { TeamCard } from "@/ui/features/team/team-card"
import { useMessageText } from "@/ui/shared/i18n"
import { AppHeader } from "../app-header"
import { AppLayout } from "../app-layout"
import { AppNotices } from "../app-notices"
import { DEMO_SCENARIO_LABELS } from "../demoLabels"
import { downloadJson } from "../download"
import { IdleSplash } from "../idle-splash"
import { useMission } from "../useMission"
import { useNavigation } from "../useNavigation"
import { readViewMode } from "../viewMode"

export interface AppShellProps {
  readonly controller: MissionController
  readonly fixtureControls: FixtureControls | null
}

function demoLocked(view: MissionViewState): boolean {
  return (
    view.snapshot !== null && view.command.phase !== "idle" && view.command.phase !== "failed"
  )
}

export function AppShell({ controller, fixtureControls }: AppShellProps) {
  const view = useMission(controller)
  const navigation = useNavigation(view)
  const navigationSupported = navigationStartDisabledReason(view) === null
  const [viewMode] = useState(() => readViewMode(window.location.search))
  const text = useMessageText()
  const [scenario, setScenario] = useState<FixtureScenarioName>(
    fixtureControls?.getScenario() ?? DEFAULT_FIXTURE_SCENARIO,
  )
  const snapshot = view.snapshot
  const robotStatusLabel = (robot: TeamRobotView) => text({ key: STATUS_LABELS[robot.status] })
  const goalLabel = (robot: TeamRobotView) =>
    robot.current_goal === null ? null : text({ key: GOAL_LABELS[robot.current_goal.kind] })

  const demo =
    fixtureControls === null ? undefined : (
      <DemoPicker
        scenarios={FIXTURE_SCENARIOS}
        value={scenario}
        disabled={demoLocked(view)}
        labelOf={(name) => DEMO_SCENARIO_LABELS[name]}
        onChange={(next) => {
          setScenario(next)
          fixtureControls.setScenario(next)
        }}
      />
    )

  return (
    <AppLayout
      view={viewMode}
      restLabel={text({ key: "mission:panels.details" })}
      extraLabel={text({ key: "mission:panels.research" })}
      header={
        <AppHeader
          brand={text({ key: "common:app.name" })}
          demo={demo}
          locale={<LocaleSwitch />}
        />
      }
      notice={<AppNotices view={view} />}
      map={
        <>
          {navigation.taskType === "research" && <IdleSplash view={view} />}
          <MapCard
            map={view.map}
            snapshot={snapshot}
            mapError={view.mapError}
            stale={view.connection === "stale"}
            motionIndex={0}
            draftTarget={
              navigation.taskType === "navigation" ? navigation.evaluation.point : null
            }
            onPick={navigation.selectable ? navigation.pick : undefined}
          />
        </>
      }
      mission={
        <MissionCard
          view={view}
          controller={controller}
          motionIndex={1}
          taskType={navigation.taskType}
          navigationTarget={navigation.evaluation.target}
          navigationBlocked={!navigationSupported || navigation.evaluation.target === null}
          taskFields={
            <NavigationFields
              taskType={navigation.taskType}
              onTaskType={navigation.setTaskType}
              draft={navigation.draft}
              evaluation={navigation.evaluation}
              locked={navigation.locked}
              supported={navigationSupported}
              onUpdate={navigation.update}
              onConfirm={navigation.confirm}
              onClear={navigation.clear}
            />
          }
        />
      }
      primary={
        <>
          <TeamCard
            team={snapshot?.team ?? null}
            batteryInitial={snapshot?.battery_initial ?? 1}
            robotStatusLabel={robotStatusLabel}
            goalLabel={goalLabel}
            motionIndex={2}
          />
          <ResearchCard snapshot={snapshot} motionIndex={3} />
        </>
      }
      secondary={
        <>
          <JournalCard
            view={view}
            controller={controller}
            onExported={(result) => downloadJson(`journal-${result.run_id}.json`, result)}
            motionIndex={4}
          />
        </>
      }
    />
  )
}
