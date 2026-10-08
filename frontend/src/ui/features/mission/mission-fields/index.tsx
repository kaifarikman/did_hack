import { MAP_MODES, type MapMode, SCENARIOS, type Scenario } from "@/domain/contract"
import { useMessageText } from "@/ui/shared/i18n"
import { NumberField, Segmented, TextArea } from "@/ui/shared/ui"
import { MAP_MODE_LABELS, SCENARIO_LABELS } from "../labels"
import styles from "./styles.module.css"

export const ROBOT_COUNTS = ["1", "2"] as const
export type RobotCount = (typeof ROBOT_COUNTS)[number]

export interface MissionDraft {
  readonly scenario: Scenario
  readonly mapMode: MapMode
  readonly robots: RobotCount
  readonly seed: number | null
  readonly missionText: string
}

export interface MissionAllowance {
  readonly scenarios: readonly string[]
  readonly mapModes: readonly string[]
  readonly robotCounts: readonly number[]
}

export interface MissionFieldsProps {
  readonly draft: MissionDraft
  readonly allowed: MissionAllowance
  readonly unsupported: string
  readonly seedError: string | undefined
  readonly onScenario: (value: Scenario) => void
  readonly onMapMode: (value: MapMode) => void
  readonly onRobots: (value: RobotCount) => void
  readonly onSeed: (value: number | null) => void
  readonly onMissionText: (value: string) => void
}

export function MissionFields({
  draft,
  allowed,
  unsupported,
  seedError,
  onScenario,
  onMapMode,
  onRobots,
  onSeed,
  onMissionText,
}: MissionFieldsProps) {
  const text = useMessageText()
  return (
    <div className={styles.fields} data-motion="fade">
      <Segmented
        showLabel
        className={styles.wide}
        label={text({ key: "mission:form.scenario" })}
        value={draft.scenario}
        onChange={onScenario}
        options={SCENARIOS.map((value) => ({
          value,
          label: text({ key: SCENARIO_LABELS[value] }),
          disabled: !allowed.scenarios.includes(value),
          disabledReason: unsupported,
        }))}
      />
      <Segmented
        showLabel
        className={styles.wide}
        label={text({ key: "mission:form.mapMode" })}
        value={draft.mapMode}
        onChange={onMapMode}
        options={MAP_MODES.map((value) => ({
          value,
          label: text({ key: MAP_MODE_LABELS[value] }),
          disabled: !allowed.mapModes.includes(value),
          disabledReason: unsupported,
        }))}
      />
      <Segmented
        showLabel
        className={styles.wide}
        label={text({ key: "mission:form.robots" })}
        value={draft.robots}
        onChange={onRobots}
        options={ROBOT_COUNTS.map((value) => ({
          value,
          label: value,
          disabled: !allowed.robotCounts.includes(Number(value)),
          disabledReason: unsupported,
        }))}
      />
      <NumberField
        label={text({ key: "mission:form.seed" })}
        value={draft.seed}
        onChange={onSeed}
        step={1}
        min={0}
        error={seedError}
      />
      <TextArea
        className={styles.wide}
        label={text({ key: "mission:form.missionText" })}
        value={draft.missionText}
        onChange={onMissionText}
        placeholder={text({ key: "mission:form.missionPlaceholder" })}
        minRows={2}
      />
    </div>
  )
}
