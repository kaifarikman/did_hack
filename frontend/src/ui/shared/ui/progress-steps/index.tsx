import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { staggerStyle } from "../../motion"
import { Icon, type IconName } from "../icon"
import styles from "./styles.module.css"

export type ProgressStepStatus = "pending" | "active" | "done" | "rejected" | "dropped"

export interface ProgressStep {
  readonly id: string
  readonly label: string
  readonly status: ProgressStepStatus
  readonly detail?: ReactNode
}

export interface ProgressStepsProps {
  readonly label: string
  readonly steps: readonly ProgressStep[]
  readonly className?: string | undefined
}

const STEP_ICON: Readonly<Record<ProgressStepStatus, IconName>> = {
  pending: "pending",
  active: "target",
  done: "check",
  rejected: "refuted",
  dropped: "dropped",
}

export function ProgressSteps({ label, steps, className }: ProgressStepsProps) {
  const { t } = useTranslation()
  return (
    <ol
      className={className === undefined ? styles.steps : `${styles.steps} ${className}`}
      aria-label={label}
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={styles.step}
          data-status={step.status}
          data-motion="fade"
          style={staggerStyle(index)}
          aria-current={step.status === "active" ? "step" : undefined}
        >
          <span className={styles.marker}>
            <Icon
              key={step.status}
              name={STEP_ICON[step.status]}
              size="sm"
              className={styles.icon}
            />
          </span>
          <span className={styles.body}>
            <span className={styles.label}>{step.label}</span>
            <span className="visually-hidden">{t(`step.${step.status}`)}</span>
            {step.detail === undefined ? null : (
              <span className={styles.detail}>{step.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
