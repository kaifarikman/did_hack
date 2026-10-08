import { type KeyboardEvent, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Field } from "../field"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export interface NumberFieldProps {
  readonly label: string
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly step?: number | undefined
  readonly unit?: string | undefined
  readonly hint?: string | undefined
  readonly error?: string | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

const NUMBER_PATTERN = /^-?\d*(\.\d*)?$/

export function clampNumber(value: number, min?: number, max?: number): number {
  const lower = min === undefined ? value : Math.max(min, value)
  return max === undefined ? lower : Math.min(max, lower)
}

export function parseNumberText(text: string): number | null {
  const normalized = text.trim().replace(",", ".")
  if (normalized === "" || normalized === "-" || !NUMBER_PATTERN.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  error,
  disabled = false,
  className,
}: NumberFieldProps) {
  const { t } = useTranslation()
  const [text, setText] = useState(value === null ? "" : String(value))

  useEffect(() => {
    setText((current) =>
      parseNumberText(current) === value ? current : value === null ? "" : String(value),
    )
  }, [value])

  const commit = (next: number) => {
    const clamped = clampNumber(next, min, max)
    setText(String(clamped))
    onChange(clamped)
  }
  const stepBy = (direction: 1 | -1) => commit((value ?? min ?? 0) + direction * step)
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    stepBy(event.key === "ArrowUp" ? 1 : -1)
  }

  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <div className={styles.group} data-disabled={disabled}>
          <button
            type="button"
            className={styles.step}
            aria-label={t("action.decrease")}
            disabled={disabled || (min !== undefined && value !== null && value <= min)}
            onClick={() => stepBy(-1)}
          >
            <Icon name="minus" size="sm" />
          </button>
          <input
            {...control}
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={text}
            disabled={disabled}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              const nextText = event.target.value
              if (!NUMBER_PATTERN.test(nextText.trim().replace(",", "."))) return
              setText(nextText)
              onChange(parseNumberText(nextText))
            }}
            onBlur={() => {
              if (value !== null) commit(value)
            }}
          />
          {unit === undefined ? null : <span className={styles.unit}>{unit}</span>}
          <button
            type="button"
            className={styles.step}
            aria-label={t("action.increase")}
            disabled={disabled || (max !== undefined && value !== null && value >= max)}
            onClick={() => stepBy(1)}
          >
            <Icon name="plus" size="sm" />
          </button>
        </div>
      )}
    </Field>
  )
}
