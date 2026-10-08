import { ApiError } from "../../application/errors"
import type { StartRunRequest } from "../../domain/contract"
import { fixtureMap, idleSnapshot } from "./baseline"
import { buildNavigationScript, type NavigationFixtureScenario } from "./navigationFixture"
import { planGridRoute } from "./navigationRoute"
import type { FixtureScript } from "./script"
export const NAVIGATION_OUTAGE_FRAME_INDEX = 6
export function isNavigationScenario(name: string): name is NavigationFixtureScenario {
  return name.startsWith("nav_")
}
export function validateNavigationRequest(request: StartRunRequest): void {
  const navigation = request.task_type === "navigation"
  if (navigation !== (request.navigation_target !== undefined))
    throw new ApiError(422, "invalid_request", "Invalid navigation target fields", false)
  if (
    navigation &&
    (request.scenario !== "easy" ||
      (request.map_mode ?? "static") !== "static" ||
      (request.robot_count ?? 1) !== 1)
  )
    throw new ApiError(409, "scenario_unavailable", "Navigation requires easy/static/1", false)
}
export function navigationScript(
  request: StartRunRequest,
  scenario: string,
  mapId: string,
  template: FixtureScript,
): FixtureScript {
  const target = request.navigation_target
  if (
    target === undefined ||
    !Number.isFinite(target.position_x_m) ||
    !Number.isFinite(target.position_y_m)
  )
    throw new ApiError(422, "invalid_request", "Coordinates must be finite", false)
  if (scenario === "nav_refused")
    throw new ApiError(409, "scenario_unavailable", "Navigation is unavailable", false)
  if (target.map_id !== mapId) throw new ApiError(409, "map_changed", "Map changed", false)
  const base = idleSnapshot.base_position
  const route = base === null ? null : planGridRoute(fixtureMap, base, target)
  if (base === null || route === null)
    throw new ApiError(422, "navigation_target_unreachable", "Target is unreachable", false)
  const navigation = buildNavigationScript({
    scenario: isNavigationScenario(scenario) ? scenario : "nav_success",
    target,
    base,
    route,
    mapId,
  })
  return {
    ...template,
    ...navigation,
    maps: [{ fromFrame: -1, map: { ...fixtureMap, map_id: mapId } }],
    behavior: {
      ...template.behavior,
      outage:
        scenario === "nav_disconnect"
          ? { atFrame: NAVIGATION_OUTAGE_FRAME_INDEX, requests: 9 }
          : null,
    },
  }
}
