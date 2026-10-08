import type { MissionViewState } from "./viewState"
export function navigationStartDisabledReason(view: MissionViewState): "unsupported" | null {
  const health = view.health
  return health?.supported_task_types.includes("navigation") &&
    health.supported_scenarios.includes("easy") &&
    health.supported_map_modes.includes("static") &&
    health.supported_robot_counts.includes(1)
    ? null
    : "unsupported"
}
