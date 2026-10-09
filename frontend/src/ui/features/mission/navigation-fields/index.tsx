import type { TaskType } from "@/domain/contract"
import type { DraftEvaluation, NavigationDraft } from "@/domain/navigationDraft"
import { useMessageText } from "@/ui/shared/i18n"
import { Button, Segmented, TextField } from "@/ui/shared/ui"
import styles from "./styles.module.css"
export interface NavigationFieldsProps {
  readonly taskType: TaskType
  readonly onTaskType: (value: TaskType) => void
  readonly draft: NavigationDraft
  readonly evaluation: DraftEvaluation
  readonly locked: boolean
  readonly supported: boolean
  readonly onUpdate: (axis: "xText" | "yText", value: string) => void
  readonly onConfirm: () => void
  readonly onClear: () => void
}
export function NavigationFields(props: NavigationFieldsProps) {
  const text = useMessageText()
  const { taskType, draft, evaluation, locked } = props
  return (
    <div className={styles.fields}>
      {(props.supported || taskType === "navigation") && (
        <Segmented
          showLabel
          label={text({ key: "mission:navigation.type" })}
          value={taskType}
          onChange={props.onTaskType}
          disabled={locked}
          options={[
            { value: "research", label: text({ key: "mission:navigation.research" }) },
            ...(props.supported
              ? [
                  {
                    value: "navigation" as const,
                    label: text({ key: "mission:navigation.navigation" }),
                  },
                ]
              : []),
          ]}
        />
      )}
      {taskType === "navigation" && (
        <>
          <p>{text({ key: "mission:navigation.hint" })}</p>
          <p>{text({ key: "mission:navigation.profile" })}</p>
          <div className={styles.coordinates}>
            <TextField
              label={text({ key: "mission:navigation.x" })}
              value={draft.xText}
              onChange={(value) => props.onUpdate("xText", value)}
              disabled={locked}
            />
            <TextField
              label={text({ key: "mission:navigation.y" })}
              value={draft.yText}
              onChange={(value) => props.onUpdate("yText", value)}
              disabled={locked}
            />
          </div>
          {evaluation.problem !== null && (
            <p role="status">
              {text({ key: `mission:navigation.problem.${evaluation.problem}` })}
            </p>
          )}
          {evaluation.warning !== null && (
            <p>{text({ key: `mission:navigation.warning.${evaluation.warning}` })}</p>
          )}
          {evaluation.problem === "map_changed" && (
            <Button disabled={locked} onClick={props.onConfirm}>
              {text({ key: "mission:navigation.confirm" })}
            </Button>
          )}
          <Button variant="ghost" disabled={locked} onClick={props.onClear}>
            {text({ key: "mission:navigation.clear" })}
          </Button>
        </>
      )}
    </div>
  )
}
