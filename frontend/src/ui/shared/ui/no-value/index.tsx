import { useTranslation } from "react-i18next"
import styles from "./styles.module.css"

export interface NoValueProps {
  readonly label?: string
}

export function NoValue({ label }: NoValueProps) {
  const { t } = useTranslation()
  return (
    <span className={styles.none} data-no-value="">
      <span aria-hidden="true">{t("value.none")}</span>
      <span className="visually-hidden">{label ?? t("value.noneLabel")}</span>
    </span>
  )
}
