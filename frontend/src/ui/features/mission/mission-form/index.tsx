import { clsx } from "clsx"
import { type ReactNode, useState } from "react"
import {
  type MissionViewState,
  startDisabledReason,
  stopDisabledReason,
} from "@/application/viewState"
import type { MapMode, Scenario } from "@/domain/contract"
import { useMessageText } from "@/ui/shared/i18n"
import { Button, ScrollArea } from "@/ui/shared/ui"
import { type MissionKey, START_BLOCKER_LABELS, STOP_BLOCKER_LABELS } from "../labels"
import {
  type MissionAllowance,
  type MissionDraft,
  MissionFields,
  type RobotCount,
} from "../mission-fields"
import styles from "./styles.module.css"

interface StartRequest {
  readonly seed: number
  readonly scenario: Scenario
  readonly missionText: string
  readonly mapMode: MapMode
  readonly robotCount: number
}

export interface MissionFormProps {
  readonly view: MissionViewState
  readonly onStart: (request: StartRequest) => void
  readonly onStop: () => void
  readonly compact?: boolean
  readonly lead?: ReactNode
  readonly notice?: ReactNode
  readonly className?: string | undefined
}

const DEFAULT_SEED = 42

function supportedOf(view: MissionViewState): MissionAllowance {
  return {
    scenarios: view.health?.supported_scenarios ?? ["easy"],
    mapModes: view.health?.supported_map_modes ?? ["static"],
    robotCounts: view.health?.supported_robot_counts ?? [1],
  }
}

function isSupported(allowed: MissionAllowance, draft: MissionDraft): boolean {
  return (
    allowed.scenarios.includes(draft.scenario) &&
    allowed.mapModes.includes(draft.mapMode) &&
    allowed.robotCounts.includes(Number(draft.robots))
  )
}

function formHint(
  view: MissionViewState,
  compact: boolean,
  startHint: string | undefined,
  stopHint: string | undefined,
): string | undefined {
  if (view.command.phase !== "idle") return undefined
  return compact ? stopHint : startHint
}

export function MissionForm({
  view,
  onStart,
  onStop,
  compact = false,
  lead,
  notice,
  className,
}: MissionFormProps) {
  const text = useMessageText()
  const [scenario, setScenario] = useState<Scenario>("easy")
  const [mapMode, setMapMode] = useState<MapMode>("static")
  const [robots, setRobots] = useState<RobotCount>("1")
  const [seed, setSeed] = useState<number | null>(DEFAULT_SEED)
  const [missionText, setMissionText] = useState("")
  const draft: MissionDraft = { scenario, mapMode, robots, seed, missionText }
  const allowed = supportedOf(view)
  const unsupported = text({ key: "mission:form.unsupported" })
  const optionalText = (key: MissionKey | null) => (key === null ? undefined : text({ key }))
  const startBlocker = startDisabledReason(view)
  const stopBlocker = stopDisabledReason(view)
  const seedValid = seed !== null && Number.isInteger(seed)
  const supported = isSupported(allowed, draft)
  const startHint = optionalText(
    startBlocker === null ? null : START_BLOCKER_LABELS[startBlocker],
  )
  const stopHint = optionalText(stopBlocker === null ? null : STOP_BLOCKER_LABELS[stopBlocker])
  const busy = view.command.phase === "sending"
  const startReason =
    startHint ??
    optionalText(supported ? null : "mission:form.unsupported") ??
    optionalText(seedValid ? null : "mission:form.seedInvalid")
  const hint = formHint(view, compact, startHint, stopHint)
  const scrolled = lead !== undefined || !compact

  return (
    <form
      className={clsx(styles.form, className)}
      onSubmit={(event) => {
        event.preventDefault()
        if (seed === null) return
        onStart({ seed, scenario, missionText, mapMode, robotCount: Number(robots) })
      }}
    >
      {scrolled && (
        <ScrollArea className={styles.scroll} label={text({ key: "mission:panels.state" })}>
          <div className={styles.body}>
            {lead}
            {!compact && (
              <MissionFields
                draft={draft}
                allowed={allowed}
                unsupported={unsupported}
                seedError={seedValid ? undefined : text({ key: "mission:form.seedInvalid" })}
                onScenario={setScenario}
                onMapMode={setMapMode}
                onRobots={setRobots}
                onSeed={setSeed}
                onMissionText={setMissionText}
              />
            )}
          </div>
        </ScrollArea>
      )}
      <div className={styles.footer}>
        {notice}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            icon="play"
            pending={busy && view.command.kind === "start"}
            disabled={startBlocker !== null || !seedValid || !supported}
            disabledReason={startReason}
          >
            {text({ key: "mission:action.start" })}
          </Button>
          <Button
            variant="dark"
            icon="stop"
            pending={busy && view.command.kind === "stop"}
            disabled={stopBlocker !== null}
            disabledReason={stopHint}
            onClick={onStop}
          >
            {text({ key: "mission:action.stop" })}
          </Button>
        </div>
        {hint !== undefined && <p className={styles.hint}>{hint}</p>}
      </div>
    </form>
  )
}
