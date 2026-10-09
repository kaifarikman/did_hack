import type { MapMode, Scenario } from "@/domain/contract"
import { useMessageText } from "@/ui/shared/i18n"
import { Eyebrow, NumberField, Segmented, TextArea } from "@/ui/shared/ui"
import type { SegmentedOption } from "@/ui/shared/ui/segmented"
import { MAP_MODE_LABELS, SCENARIO_LABELS } from "../labels"
import { supportedChoices } from "./choices"
import type { MissionAllowance, MissionDraft, RobotCount } from "./contract"
import styles from "./styles.module.css"

export type { MissionAllowance, MissionDraft, RobotCount } from "./contract"

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
  const choices = supportedChoices(allowed)
  return (
    <div className={styles.fields} data-motion="fade">
      <CapabilityChoice
        unsupported={unsupported}
        label={text({ key: "mission:form.scenario" })}
        value={draft.scenario}
        onChange={onScenario}
        options={choices.scenarios.map((value) => ({
          value,
          label: text({ key: SCENARIO_LABELS[value] }),
        }))}
      />
      <CapabilityChoice
        unsupported={unsupported}
        label={text({ key: "mission:form.mapMode" })}
        value={draft.mapMode}
        onChange={onMapMode}
        options={choices.mapModes.map((value) => ({
          value,
          label: text({ key: MAP_MODE_LABELS[value] }),
        }))}
      />
      <CapabilityChoice
        unsupported={unsupported}
        label={text({ key: "mission:form.robots" })}
        value={draft.robots}
        onChange={onRobots}
        options={choices.robots.map((value) => ({
          value,
          label: value,
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

interface CapabilityChoiceProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: readonly SegmentedOption<T>[]
  readonly onChange: (value: T) => void
  readonly unsupported: string
}

function CapabilityChoice<T extends string>(props: CapabilityChoiceProps<T>) {
  if (props.options.length > 1)
    return <Segmented {...props} showLabel className={styles.wide} />
  return (
    <div className={styles.wide}>
      <Eyebrow>{props.label}</Eyebrow>
      <p>{props.options[0]?.label ?? props.unsupported}</p>
    </div>
  )
}
