import { useMessageText } from "@/ui/shared/i18n"
import { Select, StatusBadge } from "@/ui/shared/ui"
import { DEMO_BADGE_LABEL, DEMO_PICKER_LABEL, type DemoKey } from "../labels"
import styles from "./styles.module.css"

export interface DemoPickerProps<T extends string> {
  readonly scenarios: readonly T[]
  readonly value: T
  readonly onChange: (scenario: T) => void
  readonly disabled: boolean
  readonly labelOf: (scenario: T) => DemoKey
}

export function DemoPicker<T extends string>({
  scenarios,
  value,
  onChange,
  disabled,
  labelOf,
}: DemoPickerProps<T>) {
  const text = useMessageText()
  return (
    <div className={styles.picker}>
      <span className={styles.slot}>
        <StatusBadge tone="attention" icon="info">
          {text({ key: DEMO_BADGE_LABEL })}
        </StatusBadge>
      </span>
      <Select<T>
        hideLabel
        label={text({ key: DEMO_PICKER_LABEL })}
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={scenarios.map((scenario) => ({
          value: scenario,
          label: text({ key: labelOf(scenario) }),
        }))}
      />
    </div>
  )
}
