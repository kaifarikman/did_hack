import type {
  CollectedSample,
  HazardView,
  MissionSnapshot,
  Point,
  RobotPose,
  TerrainEstimate,
} from "@/domain/contract"

export interface SceneRobot {
  readonly id: string
  readonly partner: boolean
  readonly lost: boolean
  readonly pose: RobotPose | null
  readonly trail: readonly Point[]
  readonly plannedPath: readonly Point[]
  readonly reservation: Point | null
}

interface ScenePlanStep {
  readonly number: number
  readonly target: Point
}

export interface MapScene {
  readonly runId: string | null
  readonly robots: readonly SceneRobot[]
  readonly base: Point | null
  readonly goal: Point | null
  readonly samples: readonly CollectedSample[]
  readonly hazards: readonly HazardView[]
  readonly terrain: readonly TerrainEstimate[]
  readonly planSteps: readonly ScenePlanStep[]
}

const LEADER_ID = "robot_1"
const ROUTE_TOLERANCE_M = 0.02

export const EMPTY_SCENE: MapScene = {
  runId: null,
  robots: [],
  base: null,
  goal: null,
  samples: [],
  hazards: [],
  terrain: [],
  planSteps: [],
}

function leaderOf(snapshot: MissionSnapshot): SceneRobot {
  const teamLeader = snapshot.team?.robots[0]
  return {
    id: teamLeader?.robot_id ?? LEADER_ID,
    partner: false,
    lost: false,
    pose: snapshot.robot_pose,
    trail: snapshot.trajectory,
    plannedPath: snapshot.planned_path,
    reservation: teamLeader?.reservation ?? null,
  }
}

function partnersOf(snapshot: MissionSnapshot): SceneRobot[] {
  const team = snapshot.team
  if (team === null) return []
  return team.robots.slice(1).map((robot) => ({
    id: robot.robot_id,
    partner: true,
    lost: team.lost_robots.includes(robot.robot_id),
    pose: robot.robot_pose,
    trail: robot.trajectory,
    plannedPath: robot.planned_path,
    reservation: robot.reservation,
  }))
}

export function buildScene(snapshot: MissionSnapshot | null): MapScene {
  if (snapshot === null) return EMPTY_SCENE
  const planSteps: ScenePlanStep[] = []
  ;(snapshot.plan?.steps ?? []).forEach((step, index) => {
    if (step.status === "pending" && step.target !== null) {
      planSteps.push({ number: index + 1, target: step.target })
    }
  })
  return {
    runId: snapshot.run_id,
    robots: [leaderOf(snapshot), ...partnersOf(snapshot)],
    base: snapshot.base_position,
    goal: snapshot.current_goal?.target ?? null,
    samples: snapshot.collected_samples,
    hazards: snapshot.research?.hazards ?? [],
    terrain: [...snapshot.terrain_estimates].sort(
      (first, second) => second.confidence - first.confidence,
    ),
    planSteps,
  }
}

function lies(place: Point, path: readonly Point[]): boolean {
  return path.some(
    (other) =>
      Math.abs(other.position_x_m - place.position_x_m) <= ROUTE_TOLERANCE_M &&
      Math.abs(other.position_y_m - place.position_y_m) <= ROUTE_TOLERANCE_M,
  )
}

export function isNewRoute(previous: readonly Point[], next: readonly Point[]): boolean {
  if (next.length < 2) return false
  if (previous.length < 2) return true
  const probes = next.slice(0, 2)
  return !probes.every((place) => lies(place, previous))
}

export function pointKey(place: Point | null): string | null {
  if (place === null) return null
  return `${place.position_x_m.toFixed(2)}:${place.position_y_m.toFixed(2)}`
}

export function hazardKey(hazard: HazardView): string {
  return `${hazard.detection_id}#${hazard.hits}`
}
