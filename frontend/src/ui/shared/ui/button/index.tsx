import { clsx } from "clsx"
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react"
import { Icon, type IconName } from "../icon"
import { Tooltip } from "../tooltip"
import styles from "./styles.module.css"

export type ButtonVariant = "primary" | "dark" | "ghost"
export type ButtonSize = "regular" | "compact" | "icon"
export type ButtonShape = "default" | "pill"

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly shape?: ButtonShape
  readonly icon?: IconName
  readonly iconPosition?: "start" | "end"
  readonly pending?: boolean
  readonly fullWidth?: boolean
  readonly disabledReason?: string | undefined
  readonly type?: "button" | "submit"
  readonly ref?: Ref<HTMLButtonElement> | undefined
  readonly children: ReactNode
}

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string | undefined>> = {
  primary: styles.primary,
  dark: styles.dark,
  ghost: styles.ghost,
}

const SIZE_CLASS: Readonly<Record<ButtonSize, string | undefined>> = {
  regular: undefined,
  compact: styles.compact,
  icon: styles.iconOnly,
}

export function Button({
  variant = "primary",
  size = "regular",
  shape = "default",
  icon,
  iconPosition = "start",
  pending = false,
  fullWidth = false,
  disabledReason,
  disabled = false,
  type = "button",
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const explained = disabled && disabledReason !== undefined
  const glyphSize = size === "icon" ? "md" : "sm"
  const glyph = pending ? (
    <Icon name="loader" size={glyphSize} className={styles.spinner} />
  ) : icon === undefined ? null : (
    <Icon name={icon} size={glyphSize} />
  )
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending || explained) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  const button = (
    <button
      {...rest}
      type={type}
      disabled={disabled && !explained}
      className={clsx(
        styles.button,
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        shape === "pill" && styles.pill,
        fullWidth && styles.full,
        className,
      )}
      aria-busy={pending || undefined}
      aria-disabled={pending || explained || undefined}
      data-disabled={explained || undefined}
      data-variant={variant}
      onClick={handleClick}
    >
      {iconPosition === "start" && glyph}
      <span className={size === "icon" ? "visually-hidden" : styles.label}>{children}</span>
      {iconPosition === "end" && glyph}
    </button>
  )
  return explained ? <Tooltip content={disabledReason}>{button}</Tooltip> : button
}
