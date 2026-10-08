import { clsx } from "clsx"
import { Field } from "../field"
import styles from "./styles.module.css"

export interface TextFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string | undefined
  readonly maxLength?: number | undefined
  readonly hint?: string | undefined
  readonly error?: string | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
  error,
  disabled,
  className,
}: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <input
          {...control}
          className={clsx(styles.input)}
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
