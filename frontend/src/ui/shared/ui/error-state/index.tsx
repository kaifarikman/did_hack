import { clsx } from "clsx"
import { useTranslation } from "react-i18next"
import { Button } from "../button"
import { Icon } from "../icon"
import styles from "./styles.module.css"

export interface ErrorStateProps {
  readonly title: string
  readonly description?: string | undefined
  readonly onRetry?: (() => void) | undefined
  readonly retryPending?: boolean | undefined
  readonly className?: string | undefined
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryPending = false,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation()
  return (
    <div className={clsx(styles.error, className)} role="alert" data-motion="fade">
      <Icon name="critical" size="lg" />
      <p className={styles.title}>{title}</p>
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
      {onRetry === undefined ? null : (
        <Button
          variant="dark"
          size="compact"
          icon="retry"
          pending={retryPending}
          onClick={onRetry}
        >
          {t("action.retry")}
        </Button>
      )}
    </div>
  )
}
