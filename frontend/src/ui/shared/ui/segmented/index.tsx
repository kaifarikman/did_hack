import { clsx } from "clsx"
import { useId } from "react"
import { useInputModality, useSlidingIndicator } from "../../motion"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly icon?: IconName
  readonly disabled?: boolean
  readonly disabledReason?: string
}

export interface SegmentedProps<T extends string> {
  readonly label: string
  readonly options: readonly SegmentedOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly size?: "regular" | "compact"
  readonly disabled?: boolean
  readonly showLabel?: boolean | undefined
  readonly className?: string | undefined
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "regular",
  disabled = false,
  showLabel = false,
  className,
}: SegmentedProps<T>) {
  const name = useId()
  const modality = useInputModality()
  const { listRef, indicatorRef, itemRef } = useSlidingIndicator<HTMLFieldSetElement>(value, {
    instant: modality.instant,
  })

  const group = (
    <fieldset
      ref={listRef}
      className={clsx(
        styles.segmented,
        size === "compact" && styles.compact,
        !showLabel && className,
      )}
      disabled={disabled}
      onKeyDown={modality.onKeyDown}
      onPointerDown={modality.onPointerDown}
    >
      <legend className="visually-hidden">{label}</legend>
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      {options.map((option) => {
        const checked = option.value === value
        const optionDisabled = disabled || option.disabled === true
        return (
          <label
            key={option.value}
            ref={itemRef(option.value)}
            className={styles.option}
            data-checked={checked}
            data-disabled={optionDisabled}
            title={optionDisabled ? option.disabledReason : undefined}
          >
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={optionDisabled}
              onChange={() => onChange(option.value)}
            />
            {option.icon === undefined ? null : <Icon name={option.icon} size="sm" />}
            <span>{option.label}</span>
          </label>
        )
      })}
    </fieldset>
  )
  if (!showLabel) return group
  return (
    <div className={clsx(styles.labelled, className)}>
      <span className={styles.caption} aria-hidden="true">
        {label}
      </span>
      {group}
    </div>
  )
}
