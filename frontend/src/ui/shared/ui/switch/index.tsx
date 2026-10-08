import { clsx } from "clsx"
import { useInputModality } from "../../motion"
import styles from "./styles.module.css"

export interface SwitchProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

export function Switch({ label, checked, onChange, disabled = false, className }: SwitchProps) {
  const modality = useInputModality()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={clsx(styles.switch, className)}
      data-checked={checked}
      data-instant={modality.instant}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onKeyDown={modality.onKeyDown}
      onPointerDown={modality.onPointerDown}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span>{label}</span>
    </button>
  )
}
