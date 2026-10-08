import { clsx } from "clsx"
import { useTranslation } from "react-i18next"
import { Eyebrow } from "../eyebrow"
import { Icon, type IconName } from "../icon"
import { NoValue } from "../no-value"
import styles from "./styles.module.css"

export interface StatProps {
  readonly label: string
  readonly value: string | null
  readonly unit?: string
  readonly size?: "regular" | "large"
  readonly tone?: "default" | "attention"
  readonly icon?: IconName
  readonly className?: string | undefined
}

export function Stat({
  label,
  value,
  unit,
  size = "regular",
  tone = "default",
  icon,
  className,
}: StatProps) {
  const { t } = useTranslation()
  return (
    <div
      className={clsx(styles.stat, size === "large" && styles.large, className)}
      data-tone={tone}
    >
      <span className={styles.heading}>
        {icon === undefined ? null : <Icon name={icon} size="sm" className={styles.icon} />}
        <Eyebrow as="span">{label}</Eyebrow>
      </span>
      <span className={styles.figure}>
        {value === null ? (
          <NoValue />
        ) : (
          <>
            <span className={styles.value}>{value}</span>
            {unit === undefined ? null : <span className={styles.unit}>{unit}</span>}
          </>
        )}
        {tone === "attention" ? (
          <Icon name="alert" size="sm" className={styles.alert} label={t("status.attention")} />
        ) : null}
      </span>
    </div>
  )
}
