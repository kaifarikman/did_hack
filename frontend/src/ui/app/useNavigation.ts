import { useEffect, useState } from "react"
import type { MissionViewState } from "@/application/viewState"
import { isCommandBusy } from "@/application/viewState"
import type { Point, TaskType } from "@/domain/contract"
import {
  draftFromPoint,
  EMPTY_DRAFT,
  evaluateDraft,
  type NavigationDraft,
} from "@/domain/navigationDraft"
import { isGoalLocked } from "@/domain/navigationPresentation"
import { isMapMismatch } from "@/domain/status"
export function useNavigation(view: MissionViewState) {
  const [taskType, setTaskType] = useState<TaskType>("research")
  const [draft, setDraft] = useState<NavigationDraft>(EMPTY_DRAFT)
  const locked = isGoalLocked(view.snapshot) || isCommandBusy(view.command)
  const mismatch = isMapMismatch(view.snapshot, view.map)
  const mapId = view.map?.map_id ?? null
  const mapRejected = view.command.message?.key === "errors:api.map_changed"
  useEffect(() => {
    if (view.connection !== "live" || mapRejected)
      setDraft((previous) =>
        previous.mapId === null ? previous : { ...previous, mapId: null },
      )
  }, [view.connection, mapRejected])
  const evaluation = evaluateDraft(draft, view.map, mismatch)
  const selectable =
    taskType === "navigation" &&
    !locked &&
    view.connection === "live" &&
    !mismatch &&
    mapId !== null
  const pick = (point: Point) => {
    if (selectable) setDraft(draftFromPoint(point, mapId))
  }
  const update = (axis: "xText" | "yText", value: string) => {
    if (!locked)
      setDraft((previous) => ({
        ...previous,
        [axis]: value,
        mapId: view.connection === "live" && !mismatch ? mapId : null,
      }))
  }
  const confirm = () => {
    if (!locked && view.connection === "live" && !mismatch)
      setDraft((previous) => ({ ...previous, mapId }))
  }
  const clear = () => {
    if (!locked) setDraft(EMPTY_DRAFT)
  }
  return {
    taskType,
    setTaskType,
    draft,
    evaluation,
    locked,
    selectable,
    pick,
    update,
    confirm,
    clear,
  }
}
