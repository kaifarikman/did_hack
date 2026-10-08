import {
  GOAL_KINDS,
  type HazardView,
  type HypothesisView,
  type MissionGoal,
  type MissionPlanView,
  PLANNER_MODES,
  type PlanStepView,
  type ResearchView,
  RUN_STATUSES,
  SENSOR_FAULTS,
  SENSOR_STATES,
  STEP_STATUSES,
  TEAM_OUTCOMES,
  type TeamRobotView,
  type TeamView,
} from "../contract"
import {
  arrayOf,
  enumReader,
  field,
  nullable,
  numberReader,
  type Reader,
  readBoolean,
  readCount,
  readErrorInfo,
  readNonNegative,
  readObject,
  readPoint,
  readPose,
  readPositive,
  readString,
  readStrings,
  readUnitInterval,
} from "./readers"

export const readGoalKind = enumReader(GOAL_KINDS)

export const readRunStatus = enumReader(RUN_STATUSES)

export const readPlannerMode = enumReader(PLANNER_MODES)

export const readGoal: Reader<MissionGoal> = (value, path) => {
  const source = readObject(value, path)
  return {
    kind: field(source, "kind", path, readGoalKind),
    target: field(source, "target", path, nullable(readPoint)),
    reason: field(source, "reason", path, readString),
  }
}

const readPlanStep: Reader<PlanStepView> = (value, path) => {
  const step = readObject(value, path)
  return {
    ...readGoal(step, path),
    status: field(step, "status", path, enumReader(STEP_STATUSES)),
    evidence: field(step, "evidence", path, readStrings),
    revise_if: field(step, "revise_if", path, nullable(readString)),
  }
}

export const readPlan: Reader<MissionPlanView> = (value, path) => {
  const source = readObject(value, path)
  return {
    plan_id: field(source, "plan_id", path, readString),
    source: field(source, "source", path, readPlannerMode),
    rationale: field(source, "rationale", path, readString),
    premises: field(source, "premises", path, readStrings),
    fallback_reason: field(source, "fallback_reason", path, nullable(readString)),
    revision_reason: field(source, "revision_reason", path, nullable(readString)),
    steps: field(source, "steps", path, arrayOf(readPlanStep)),
  }
}

const readHazard: Reader<HazardView> = (value, path) => {
  const source = readObject(value, path)
  return {
    detection_id: field(source, "detection_id", path, readString),
    center: field(source, "center", path, readPoint),
    radius_m: field(source, "radius_m", path, readPositive),
    hits: field(source, "hits", path, numberReader({ min: 1 }, true)),
  }
}

const readHypothesis: Reader<HypothesisView> = (value, path) => {
  const source = readObject(value, path)
  return {
    hypothesis_id: field(source, "hypothesis_id", path, readString),
    kind: field(source, "kind", path, readString),
    status: field(source, "status", path, readString),
    center: field(source, "center", path, readPoint),
    prediction: field(source, "prediction", path, readString),
    measurement: field(source, "measurement", path, nullable(readString)),
    detection_id: field(source, "detection_id", path, nullable(readString)),
    experiment_id: field(source, "experiment_id", path, nullable(readString)),
  }
}

export const readResearch: Reader<ResearchView> = (value, path) => {
  const source = readObject(value, path)
  const sensorPath = `${path}.sensor`
  const sensor = readObject(source.sensor, sensorPath)
  return {
    sensor: {
      state: field(sensor, "state", sensorPath, enumReader(SENSOR_STATES)),
      fault: field(sensor, "fault", sensorPath, nullable(enumReader(SENSOR_FAULTS))),
      quality: field(sensor, "quality", sensorPath, readUnitInterval),
    },
    hazards: field(source, "hazards", path, arrayOf(readHazard)),
    hypotheses: field(source, "hypotheses", path, arrayOf(readHypothesis)),
    last_replan_reason: field(source, "last_replan_reason", path, nullable(readString)),
    last_replan_detection_id: field(
      source,
      "last_replan_detection_id",
      path,
      nullable(readString),
    ),
    planner_requests: field(source, "planner_requests", path, readCount),
  }
}

const readTeamRobot: Reader<TeamRobotView> = (value, path) => {
  const robot = readObject(value, path)
  return {
    robot_id: field(robot, "robot_id", path, readString),
    status: field(robot, "status", path, readRunStatus),
    robot_pose: field(robot, "robot_pose", path, nullable(readPose)),
    battery_remaining: field(robot, "battery_remaining", path, nullable(readNonNegative)),
    samples_collected: field(robot, "samples_collected", path, readCount),
    current_goal: field(robot, "current_goal", path, nullable(readGoal)),
    trajectory: field(robot, "trajectory", path, arrayOf(readPoint)),
    planned_path: field(robot, "planned_path", path, arrayOf(readPoint)),
    reservation: field(robot, "reservation", path, nullable(readPoint)),
    last_error: field(robot, "last_error", path, nullable(readErrorInfo)),
  }
}

export const readTeam: Reader<TeamView> = (value, path) => {
  const source = readObject(value, path)
  return {
    outcome: field(source, "outcome", path, enumReader(TEAM_OUTCOMES)),
    samples_collected: field(source, "samples_collected", path, readCount),
    coordinated: field(source, "coordinated", path, readBoolean),
    lost_robots: field(source, "lost_robots", path, readStrings),
    robots: field(source, "robots", path, arrayOf(readTeamRobot)),
  }
}
