import type { MissionPlanView } from "@/domain/contract"
import { BackendText, useMessageText } from "@/ui/shared/i18n"
import { Swap } from "@/ui/shared/motion"
import { Banner, Disclosure, EmptyState, ProgressSteps, StatusBadge } from "@/ui/shared/ui"
import { PLAN_SOURCE_LABELS, STEP_GOAL_LABELS } from "../labels"
import styles from "./styles.module.css"

export interface PlanViewProps {
  readonly plan: MissionPlanView | null
}

interface EvidenceProps {
  readonly items: readonly string[]
}

function keyedItems(items: readonly string[]): { key: string; item: string }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const count = seen.get(item) ?? 0
    seen.set(item, count + 1)
    return { key: `${item}#${count}`, item }
  })
}

function Evidence({ items }: EvidenceProps) {
  if (items.length === 0) return null
  return (
    <ul className={styles.evidence}>
      {keyedItems(items).map(({ key, item }) => (
        <BackendText as="li" key={key}>
          {item}
        </BackendText>
      ))}
    </ul>
  )
}

export function PlanView({ plan }: PlanViewProps) {
  const text = useMessageText()
  if (plan === null)
    return <EmptyState icon="plan" title={text({ key: "research:label.noPlan" })} />
  return (
    <Swap swapKey={plan.plan_id} as="div">
      <div className={styles.plan}>
        <div className={styles.heading}>
          <StatusBadge tone="neutral" icon={plan.source === "llm" ? "llm" : "fallback"}>
            {text({ key: PLAN_SOURCE_LABELS[plan.source] })}
          </StatusBadge>
        </div>
        <BackendText as="p" className={styles.rationale}>
          {plan.rationale}
        </BackendText>
        <Banner
          open={plan.fallback_reason !== null}
          tone="attention"
          icon="fallback"
          title={text({ key: "research:label.fallbackReason" })}
        >
          <BackendText>{plan.fallback_reason}</BackendText>
        </Banner>
        <Banner
          open={plan.revision_reason !== null}
          tone="info"
          icon="retry"
          title={text({ key: "research:label.revision" })}
        >
          <BackendText>{plan.revision_reason}</BackendText>
        </Banner>
        <ProgressSteps
          label={text({ key: "research:label.plan" })}
          steps={plan.steps.map((step, index) => ({
            id: `${plan.plan_id}-${index}`,
            label: text({ key: STEP_GOAL_LABELS[step.kind] }),
            status: step.status,
            detail: (
              <>
                <BackendText className={styles.line}>{step.reason}</BackendText>
                {step.revise_if !== null && (
                  <span className={styles.revise}>
                    <span>{text({ key: "research:label.reviseIf" })}</span>{" "}
                    <BackendText>{step.revise_if}</BackendText>
                  </span>
                )}
                <Evidence items={step.evidence} />
              </>
            ),
          }))}
        />
        {plan.premises.length > 0 && (
          <Disclosure summary={text({ key: "research:label.premises" })}>
            <Evidence items={plan.premises} />
          </Disclosure>
        )}
      </div>
    </Swap>
  )
}
