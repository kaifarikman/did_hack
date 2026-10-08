import { useEffect, useState } from "react"
import type { MissionSnapshot } from "@/domain/contract"
import { isActiveStatus, isFinishedStatus } from "@/domain/status"
import { withViewTransition } from "@/ui/shared/motion"

export type MissionLayout = "setup" | "run" | "summary"

export function missionLayoutOf(snapshot: MissionSnapshot | null): MissionLayout {
  if (snapshot === null) return "setup"
  if (isActiveStatus(snapshot.status)) return "run"
  if (isFinishedStatus(snapshot.status) && snapshot.run_id !== null) return "summary"
  return "setup"
}

export function useMissionLayout(snapshot: MissionSnapshot | null): MissionLayout {
  const target = missionLayoutOf(snapshot)
  const [shown, setShown] = useState(target)
  useEffect(() => {
    if (shown === target) return
    void withViewTransition("mission", () => setShown(target))
  }, [shown, target])
  return shown
}
