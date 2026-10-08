import type { MissionSnapshot } from "./contract"
import { isActiveStatus } from "./status"
export type NavigationStageState = "done" | "current" | "todo" | "failed"
export interface NavigationStage {
  id: "check" | "move" | "reached" | "return" | "finish"
  state: NavigationStageState
}
export function navigationStages(snapshot: MissionSnapshot): NavigationStage[] {
  const navigation = snapshot.navigation
  if (navigation === null) return []
  const { phase, target_reached: reached } = navigation
  const failed = phase === "failed" || phase === "stopped"
  const completed = snapshot.status === "completed" && phase === "finished" && reached
  const stage = (
    id: NavigationStage["id"],
    done: boolean,
    current: boolean,
  ): NavigationStage => ({
    id,
    state: done ? "done" : current ? "current" : failed ? "failed" : "todo",
  })
  return [
    stage("check", phase !== "pending", phase === "pending"),
    stage("move", reached, phase === "moving_to_target" && !reached),
    stage("reached", reached, false),
    stage("return", completed, !failed && !completed && (phase === "returning" || reached)),
    stage("finish", completed, false),
  ]
}
export function navigationOutcome(
  snapshot: MissionSnapshot,
):
  | "success"
  | "unconfirmed"
  | "stopped"
  | "failed"
  | "not_reached"
  | "return_failed"
  | "returning"
  | null {
  const navigation = snapshot.navigation
  if (navigation === null) return null
  if (snapshot.status === "completed")
    return navigation.target_reached && navigation.phase === "finished"
      ? "success"
      : "unconfirmed"
  if (snapshot.status === "stopped") return "stopped"
  if (snapshot.status === "failed")
    return snapshot.last_error?.code === "navigation_goal_not_reached"
      ? "not_reached"
      : navigation.target_reached
        ? "return_failed"
        : "failed"
  return isActiveStatus(snapshot.status) && navigation.target_reached ? "returning" : null
}
export function isGoalLocked(snapshot: MissionSnapshot | null): boolean {
  return snapshot !== null && isActiveStatus(snapshot.status)
}
