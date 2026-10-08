import {
  type CollectedSample,
  JUDGE_MODES,
  MAP_MODES,
  type MissionSnapshot,
  SCENARIOS,
  type TerrainEstimate,
} from "../contract"
import {
  arrayOf,
  ContractError,
  enumReader,
  field,
  nullable,
  numberReader,
  optionalField,
  type Reader,
  readCount,
  readErrorInfo,
  readNonNegative,
  readObject,
  readPoint,
  readPose,
  readPositive,
  readString,
  readUnitInterval,
} from "./readers"
import {
  readGoal,
  readPlan,
  readPlannerMode,
  readResearch,
  readRunStatus,
  readTeam,
} from "./research"

const SUPPORTED_SCHEMA_PREFIX = "1."

export const readJudgeMode = enumReader(JUDGE_MODES)

const readCollectedSample: Reader<CollectedSample> = (value, path) => {
  const item = readObject(value, path)
  return {
    sample_id: field(item, "sample_id", path, readString),
    position: field(item, "position", path, readPoint),
  }
}

const readTerrainEstimate: Reader<TerrainEstimate> = (value, path) => {
  const item = readObject(value, path)
  return {
    region_id: field(item, "region_id", path, readString),
    center: field(item, "center", path, readPoint),
    radius_m: field(item, "radius_m", path, readPositive),
    energy_per_m: field(item, "energy_per_m", path, readNonNegative),
    confidence: field(item, "confidence", path, readUnitInterval),
    std_energy_per_m: optionalField(
      item,
      "std_energy_per_m",
      path,
      nullable(readNonNegative),
      null,
    ),
    regime: optionalField(item, "regime", path, readCount, 0),
    last_measured_s: optionalField(
      item,
      "last_measured_s",
      path,
      nullable(readNonNegative),
      null,
    ),
  }
}

function readSchemaVersion(source: Record<string, unknown>, path: string): string {
  const schemaVersion = field(source, "schema_version", path, readString)
  if (!schemaVersion.startsWith(SUPPORTED_SCHEMA_PREFIX)) {
    throw new ContractError(`Unsupported state schema version: ${schemaVersion}`)
  }
  return schemaVersion
}

export function parseSnapshot(raw: unknown): MissionSnapshot {
  const path = "state"
  const source = readObject(raw, path)
  return {
    schema_version: readSchemaVersion(source, path),
    run_id: field(source, "run_id", path, nullable(readString)),
    revision: field(source, "revision", path, readCount),
    status: field(source, "status", path, readRunStatus),
    scenario: field(source, "scenario", path, nullable(enumReader(SCENARIOS))),
    seed: field(source, "seed", path, nullable(numberReader({}, true))),
    judge_mode: field(source, "judge_mode", path, readJudgeMode),
    planner_mode: field(source, "planner_mode", path, readPlannerMode),
    simulation_time_s: field(source, "simulation_time_s", path, nullable(readNonNegative)),
    map_id: field(source, "map_id", path, nullable(readString)),
    robot_pose: field(source, "robot_pose", path, nullable(readPose)),
    base_position: field(source, "base_position", path, nullable(readPoint)),
    battery_remaining: field(source, "battery_remaining", path, nullable(readNonNegative)),
    battery_initial: field(source, "battery_initial", path, readPositive),
    sample_signal: field(source, "sample_signal", path, nullable(readUnitInterval)),
    samples_collected: field(source, "samples_collected", path, readCount),
    return_energy_estimate: field(
      source,
      "return_energy_estimate",
      path,
      nullable(readNonNegative),
    ),
    current_goal: field(source, "current_goal", path, nullable(readGoal)),
    trajectory: field(source, "trajectory", path, arrayOf(readPoint)),
    planned_path: field(source, "planned_path", path, arrayOf(readPoint)),
    collected_samples: field(source, "collected_samples", path, arrayOf(readCollectedSample)),
    terrain_estimates: field(source, "terrain_estimates", path, arrayOf(readTerrainEstimate)),
    last_error: field(source, "last_error", path, nullable(readErrorInfo)),
    mission_text: optionalField(source, "mission_text", path, readString, ""),
    map_mode: optionalField(source, "map_mode", path, enumReader(MAP_MODES), "static"),
    target_samples: optionalField(
      source,
      "target_samples",
      path,
      nullable(numberReader({ min: 1 }, true)),
      null,
    ),
    plan: optionalField(source, "plan", path, nullable(readPlan), null),
    research: optionalField(source, "research", path, nullable(readResearch), null),
    team: optionalField(source, "team", path, nullable(readTeam), null),
  }
}
