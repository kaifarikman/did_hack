import {
  METRIC_PHASES,
  type MetricPoint,
  type RunAnalytics,
  type RunMetricsSummary,
} from "../runAnalytics"
import {
  arrayOf,
  ContractError,
  enumReader,
  field,
  nullable,
  type Reader,
  readBoolean,
  readCount,
  readNonNegative,
  readNumber,
  readObject,
  readPositive,
  readString,
  readUnitInterval,
} from "./readers"

const readPhase = enumReader(METRIC_PHASES)
const readMetricPoint: Reader<MetricPoint> = (value, path) => {
  const source = readObject(value, path)
  return {
    simulation_time_s: field(source, "simulation_time_s", path, readNonNegative),
    battery_remaining: field(source, "battery_remaining", path, nullable(readNonNegative)),
    return_energy: field(source, "return_energy", path, nullable(readNonNegative)),
    sample_signal: field(source, "sample_signal", path, nullable(readUnitInterval)),
    speed_mps: field(source, "speed_mps", path, nullable(readNonNegative)),
    phase: field(source, "phase", path, readPhase),
    continuous: field(source, "continuous", path, readBoolean),
  }
}
const readPhaseSeconds: Reader<RunMetricsSummary["phase_seconds"]> = (value, path) => {
  if (!Array.isArray(value)) throw new ContractError(`${path}: expected phase durations`)
  return value.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2)
      throw new ContractError(`${path}: invalid duration`)
    return [
      readPhase(pair[0], `${path}.${index}`),
      readNonNegative(pair[1], `${path}.${index}`),
    ]
  })
}
export const readAnalytics: Reader<RunAnalytics> = (value, path) => {
  const source = readObject(value, path)
  const summary = readObject(source.summary, `${path}.summary`)
  const planner = readObject(summary.planner, `${path}.summary.planner`)
  const history = field(source, "history", path, arrayOf(readMetricPoint))
  if (history.length > 180) throw new ContractError(`${path}: history exceeds limit`)
  return {
    summary: {
      run_id: field(summary, "run_id", path, readString),
      robot_id: field(summary, "robot_id", path, readString),
      generation: field(summary, "generation", path, readCount),
      observation_sequence: field(summary, "observation_sequence", path, nullable(readCount)),
      simulation_time_s: field(summary, "simulation_time_s", path, nullable(readNonNegative)),
      distance_m: field(summary, "distance_m", path, readNonNegative),
      speed_mps: field(summary, "speed_mps", path, nullable(readNonNegative)),
      reserve_energy: field(summary, "reserve_energy", path, readNonNegative),
      available_energy: field(summary, "available_energy", path, nullable(readNumber)),
      elapsed_sim_s: field(summary, "elapsed_sim_s", path, readNonNegative),
      elapsed_wall_s: field(summary, "elapsed_wall_s", path, readNonNegative),
      real_time_factor: field(summary, "real_time_factor", path, nullable(readNonNegative)),
      phase: field(summary, "phase", path, readPhase),
      phase_seconds: field(summary, "phase_seconds", path, readPhaseSeconds),
      planner: {
        requests: field(planner, "requests", path, readCount),
        deadline_timeouts: field(planner, "deadline_timeouts", path, readCount),
        fallbacks: field(planner, "fallbacks", path, readCount),
        last_wait_wall_s: field(planner, "last_wait_wall_s", path, nullable(readNonNegative)),
      },
    },
    history,
    history_limit: field(source, "history_limit", path, readCount),
    sample_interval_s: field(source, "sample_interval_s", path, readPositive),
  }
}
