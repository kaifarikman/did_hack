import { clsx } from "clsx"
import { type ReactNode, useId } from "react"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export interface FieldControlProps {
  readonly id: string
  readonly "aria-describedby": string | undefined
  readonly "aria-invalid": boolean
}

export interface FieldMeta {
  readonly labelId: string
}

export interface FieldProps {
  readonly label: string
  readonly hint?: string | undefined
  readonly error?: string | undefined
  readonly hideLabel?: boolean | undefined
  readonly className?: string | undefined
  readonly children: (control: FieldControlProps, meta: FieldMeta) => ReactNode
}

export function Field({
  label,
  hint,
  error,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((item): item is string => item !== null)
      .join(" ") || undefined

  return (
    <div className={clsx(styles.field, className)} data-invalid={error !== undefined}>
      <label id={labelId} htmlFor={id} className={hideLabel ? "visually-hidden" : styles.label}>
        {label}
      </label>
      {children(
        { id, "aria-describedby": describedBy, "aria-invalid": error !== undefined },
        { labelId },
      )}
      {hint === undefined ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={styles.error} data-motion="fade">
          <Icon name="alert" size="sm" />
          {error}
        </p>
      )}
    </div>
  )
}
