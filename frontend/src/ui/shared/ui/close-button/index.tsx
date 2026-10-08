import { clsx } from "clsx"
import { useTranslation } from "react-i18next"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export interface CloseButtonProps {
  readonly onClick: () => void
  readonly label?: string
  readonly tone?: "default" | "inverse"
  readonly className?: string | undefined
}

export function CloseButton({ onClick, label, tone = "default", className }: CloseButtonProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={clsx(styles.close, tone === "inverse" && styles.inverse, className)}
      aria-label={label ?? t("action.close")}
      onClick={onClick}
    >
      <Icon name="close" size="md" />
    </button>
  )
}
