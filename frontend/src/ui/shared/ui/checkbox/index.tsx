import { clsx } from "clsx"
import { useInputModality } from "../../motion"
import styles from "./styles.module.css"

export interface CheckboxProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly hint?: string | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  className,
}: CheckboxProps) {
  const modality = useInputModality()
  return (
    <label
      className={clsx(styles.checkbox, className)}
      data-checked={checked}
      data-disabled={disabled}
      data-instant={modality.instant}
      onKeyDown={modality.onKeyDown}
      onPointerDown={modality.onPointerDown}
    >
      <input
        className={styles.input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.box} aria-hidden="true">
        <svg className={styles.mark} viewBox="0 0 16 16" focusable="false" aria-hidden="true">
          <path className={styles.path} d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} />
        </svg>
      </span>
      <span className={styles.text}>
        <span>{label}</span>
        {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
      </span>
    </label>
  )
}
