import type { MissionSnapshot } from "@/domain/contract"
import {
  isGoalLocked,
  type NavigationStageState,
  navigationOutcome,
  navigationStages,
} from "@/domain/navigationPresentation"
import { useMessageText } from "@/ui/shared/i18n"
import { Banner, Card, type ProgressStepStatus, ProgressSteps } from "@/ui/shared/ui"
import styles from "./styles.module.css"

const STATUS: Record<NavigationStageState, ProgressStepStatus> = {
  done: "done",
  current: "active",
  todo: "pending",
  failed: "rejected",
}
export function NavigationRun({ snapshot }: { readonly snapshot: MissionSnapshot }) {
  const text = useMessageText()
  const navigation = snapshot.navigation
  if (navigation === null) return null
  const outcome = navigationOutcome(snapshot)
  return (
    <Card
      level="inner"
      title={text({ key: "mission:navigation.target" })}
      className={styles.run}
    >
      <p>
        {text({
          key: "mission:navigation.coordinates",
          params: { x: navigation.target.position_x_m, y: navigation.target.position_y_m },
        })}
      </p>
      <p>
        {text({
          key: "mission:navigation.tolerance",
          params: { value: navigation.arrival_tolerance_m },
        })}
      </p>
      <p>{text({ key: `mission:navigation.phase.${navigation.phase}` })}</p>
      <p>
        {text({
          key: navigation.target_reached
            ? "mission:navigation.reached"
            : "mission:navigation.notReached",
        })}
      </p>
      {isGoalLocked(snapshot) && (
        <p>
          {text({
            key:
              snapshot.planned_path.length > 0
                ? "mission:navigation.path"
                : "mission:navigation.noPath",
          })}
        </p>
      )}
      <ProgressSteps
        label={text({ key: "mission:navigation.navigation" })}
        steps={navigationStages(snapshot).map((stage) => ({
          id: stage.id,
          label: text({ key: `mission:navigation.stage.${stage.id}` }),
          status: STATUS[stage.state],
        }))}
      />
      {outcome !== null && (
        <Banner
          tone={outcome === "success" || outcome === "returning" ? "info" : "attention"}
          title={text({ key: `mission:navigation.outcome.${outcome}` })}
        />
      )}
    </Card>
  )
}
