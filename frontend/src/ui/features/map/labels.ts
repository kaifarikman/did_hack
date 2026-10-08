import type { MapData, MissionSnapshot, TerrainEstimate } from "@/domain/contract"
import type { Message, MessageKey } from "@/domain/message"
import type { Formatters } from "@/ui/shared/i18n"
import type { MapLabelText } from "./layers/frame"
import type { MapRole } from "./mapTheme"
import type { MapScene } from "./scene"

type MapKey = Extract<MessageKey, `map:${string}`>
type MapMessage = Message
type MapFormatters = Pick<Formatters, "number">

type MapTextResolver = (message: MapMessage) => string
export type LegendShape =
  | "robot"
  | "base"
  | "goal"
  | "trail"
  | "path"
  | "sample"
  | "terrain"
  | "hazard"
  | "planStep"
  | "cell"

export interface LegendItem {
  readonly role: MapRole
  readonly shape: LegendShape
  readonly label: MapKey
  readonly note?: MapKey
}

export const LEGEND: readonly LegendItem[] = [
  { role: "robot", shape: "robot", label: "map:legend.robot", note: "map:legend.robotNote" },
  { role: "base", shape: "base", label: "map:legend.base" },
  { role: "goal", shape: "goal", label: "map:legend.goal" },
  { role: "trail", shape: "trail", label: "map:legend.trail" },
  { role: "path", shape: "path", label: "map:legend.plannedPath" },
  { role: "sample", shape: "sample", label: "map:legend.sample" },
  {
    role: "soilHigh",
    shape: "terrain",
    label: "map:legend.terrain",
    note: "map:legend.terrainNote",
  },
  {
    role: "hazard",
    shape: "hazard",
    label: "map:legend.hazard",
    note: "map:legend.hazardNote",
  },
  { role: "planStep", shape: "planStep", label: "map:legend.planStep" },
  { role: "robotPartner", shape: "robot", label: "map:legend.partner" },
  { role: "obstacle", shape: "cell", label: "map:legend.obstacle" },
  { role: "free", shape: "cell", label: "map:legend.free" },
  { role: "unknown", shape: "cell", label: "map:legend.unknown" },
]

type LegendPresence = Readonly<Partial<Record<MapRole, boolean>>>

export function legendPresence(scene: MapScene, hasMap: boolean): LegendPresence {
  const leader = scene.robots.find((robot) => !robot.partner)
  return {
    robot: leader?.pose != null,
    base: scene.base !== null,
    goal: scene.goal !== null,
    trail: scene.robots.some((robot) => robot.trail.length > 0),
    path: scene.robots.some((robot) => robot.plannedPath.length > 0),
    sample: scene.samples.length > 0,
    soilHigh: scene.terrain.length > 0,
    hazard: scene.hazards.length > 0,
    planStep: scene.planSteps.length > 0,
    robotPartner: scene.robots.some((robot) => robot.partner),
    obstacle: hasMap,
    free: hasMap,
    unknown: hasMap,
  }
}

export function visibleLegend(scene: MapScene, hasMap: boolean): readonly LegendItem[] {
  const presence = legendPresence(scene, hasMap)
  return LEGEND.filter((item) => presence[item.role] === true)
}

export function terrainLabelMessage(
  estimate: TerrainEstimate,
  format: MapFormatters,
): MapMessage {
  const energy = format.number(estimate.energy_per_m, 1)
  const spread =
    estimate.std_energy_per_m === null ? null : format.number(estimate.std_energy_per_m, 1)
  const regime = estimate.regime > 0 ? estimate.regime : null
  if (spread === null && regime === null)
    return { key: "map:label.terrain", params: { energy } }
  if (spread === null)
    return { key: "map:label.terrainRegime", params: { energy, regime: regime ?? 0 } }
  if (regime === null) return { key: "map:label.terrainSpread", params: { energy, spread } }
  return { key: "map:label.terrainSpreadRegime", params: { energy, spread, regime } }
}

function hazardLabelMessage(hits: number): MapMessage {
  return { key: "map:label.hazard", params: { hits } }
}

export function createMapLabelText(
  resolve: MapTextResolver,
  format: MapFormatters,
): MapLabelText {
  return {
    terrain: (estimate) => resolve(terrainLabelMessage(estimate, format)),
    hazard: (hits) => resolve(hazardLabelMessage(hits)),
  }
}

interface MapAvailability {
  readonly map: MapData | null
  readonly snapshot: MissionSnapshot | null
  readonly mapError: string | null
  readonly mismatch: boolean
}

export function mapStateMessage({
  map,
  snapshot,
  mapError,
  mismatch,
}: MapAvailability): MapMessage | null {
  if (map === null)
    return { key: mapError === null ? "map:state.loading" : "map:state.missing" }
  if (!mismatch) return null
  return {
    key: "map:state.mismatch",
    params: { expected: snapshot?.map_id ?? "", loaded: map.map_id },
  }
}

export function describeSceneMessage(
  snapshot: MissionSnapshot | null,
  drawable: boolean,
  format: MapFormatters,
): MapMessage {
  if (!drawable || snapshot === null) return { key: "map:describe.unavailable" }
  const samples = snapshot.collected_samples.length
  const pose = snapshot.robot_pose
  if (pose === null) return { key: "map:describe.noRobot", params: { samples } }
  return {
    key: "map:describe.robot",
    params: {
      x: format.number(pose.position_x_m, 2),
      y: format.number(pose.position_y_m, 2),
      samples,
    },
  }
}
