import type {
  ErrorInfo,
  HealthStatus,
  JournalEntry,
  JournalPage,
  MapData,
  MissionGoal,
  MissionSnapshot,
  Point,
} from "./contract";
import { SCENARIOS, SENSOR_FAULTS, SENSOR_STATES, STEP_STATUSES } from "./contract";
import type { HazardView, HypothesisView, MissionPlanView, ResearchView } from "./contract";

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

type Reader<T> = (value: unknown, path: string) => T;
type JsonObject = Record<string, unknown>;

function describeValue(value: unknown): string {
  if (value === undefined) return "поле отсутствует";
  if (value === null) return "null";
  if (typeof value === "string") return `строка "${value.slice(0, 40)}"`;
  if (Array.isArray(value)) return "массив";
  return typeof value === "object" ? "объект" : String(value);
}

function fail(path: string, expected: string, value: unknown): never {
  throw new ContractError(
    `Некорректный ответ сервера: ${path} — ожидается ${expected}, получено: ${describeValue(value)}`,
  );
}

const readObject: Reader<JsonObject> = (value, path) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "объект", value);
  return value as JsonObject;
};

const readString: Reader<string> = (value, path) => {
  if (typeof value !== "string") fail(path, "строка", value);
  return value;
};

const readBoolean: Reader<boolean> = (value, path) => {
  if (typeof value !== "boolean") fail(path, "boolean", value);
  return value;
};

interface NumberBounds {
  min?: number;
  max?: number;
  greaterThan?: number;
}

function numberReader(bounds: NumberBounds = {}, integer = false): Reader<number> {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "конечное число", value);
    if (integer && !Number.isInteger(value)) fail(path, "целое число", value);
    if (bounds.min !== undefined && value < bounds.min) fail(path, `число >= ${bounds.min}`, value);
    if (bounds.max !== undefined && value > bounds.max) fail(path, `число <= ${bounds.max}`, value);
    if (bounds.greaterThan !== undefined && value <= bounds.greaterThan) {
      fail(path, `число > ${bounds.greaterThan}`, value);
    }
    return value;
  };
}

const readNumber = numberReader();

function enumReader<T extends string>(allowed: readonly T[]): Reader<T> {
  return (value, path) => {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      fail(path, `одно из: ${allowed.join(", ")}`, value);
    }
    return value as T;
  };
}

function nullable<T>(reader: Reader<T>): Reader<T | null> {
  return (value, path) => (value === null ? null : reader(value, path));
}

function arrayOf<T>(reader: Reader<T>): Reader<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) fail(path, "массив", value);
    return value.map((item, index) => reader(item, `${path}[${index}]`));
  };
}

function field<T>(source: JsonObject, key: string, path: string, reader: Reader<T>): T {
  return reader(source[key], `${path}.${key}`);
}

/** Поле расширения 1.1: у backend 1.0 его нет — берётся значение по умолчанию. */
function optionalField<T>(source: JsonObject, key: string, path: string, reader: Reader<T>, fallback: T): T {
  return source[key] === undefined ? fallback : field(source, key, path, reader);
}

const readStrings = arrayOf(readString);

const readPoint: Reader<Point> = (value, path) => {
  const source = readObject(value, path);
  return {
    position_x_m: field(source, "position_x_m", path, readNumber),
    position_y_m: field(source, "position_y_m", path, readNumber),
  };
};

const readErrorInfo: Reader<ErrorInfo> = (value, path) => {
  const source = readObject(value, path);
  return {
    code: field(source, "code", path, readString),
    message: field(source, "message", path, readString),
    retryable: field(source, "retryable", path, readBoolean),
  };
};

const readGoal: Reader<MissionGoal> = (value, path) => {
  const source = readObject(value, path);
  return {
    kind: field(source, "kind", path, enumReader(["explore", "approach", "collect", "return"] as const)),
    target: field(source, "target", path, nullable(readPoint)),
    reason: field(source, "reason", path, readString),
  };
};

const readRunStatus = enumReader([
  "idle",
  "starting",
  "running",
  "returning",
  "stopping",
  "completed",
  "stopped",
  "failed",
] as const);

const readPlan: Reader<MissionPlanView> = (value, path) => {
  const source = readObject(value, path);
  return {
    plan_id: field(source, "plan_id", path, readString),
    source: field(source, "source", path, enumReader(["llm", "fallback"] as const)),
    rationale: field(source, "rationale", path, readString),
    premises: field(source, "premises", path, readStrings),
    fallback_reason: field(source, "fallback_reason", path, nullable(readString)),
    revision_reason: field(source, "revision_reason", path, nullable(readString)),
    steps: field(
      source,
      "steps",
      path,
      arrayOf((item, itemPath) => {
        const step = readObject(item, itemPath);
        return {
          ...readGoal(step, itemPath),
          status: field(step, "status", itemPath, enumReader(STEP_STATUSES)),
          evidence: field(step, "evidence", itemPath, readStrings),
          revise_if: field(step, "revise_if", itemPath, nullable(readString)),
        };
      }),
    ),
  };
};

const readHazard: Reader<HazardView> = (value, path) => {
  const source = readObject(value, path);
  return {
    detection_id: field(source, "detection_id", path, readString),
    center: field(source, "center", path, readPoint),
    radius_m: field(source, "radius_m", path, numberReader({ greaterThan: 0 })),
    hits: field(source, "hits", path, numberReader({ min: 1 }, true)),
  };
};

const readHypothesis: Reader<HypothesisView> = (value, path) => {
  const source = readObject(value, path);
  return {
    hypothesis_id: field(source, "hypothesis_id", path, readString),
    kind: field(source, "kind", path, readString),
    status: field(source, "status", path, readString),
    center: field(source, "center", path, readPoint),
    prediction: field(source, "prediction", path, readString),
    measurement: field(source, "measurement", path, nullable(readString)),
    detection_id: field(source, "detection_id", path, nullable(readString)),
    experiment_id: field(source, "experiment_id", path, nullable(readString)),
  };
};

const readResearch: Reader<ResearchView> = (value, path) => {
  const source = readObject(value, path);
  const sensor = readObject(source.sensor, `${path}.sensor`);
  return {
    sensor: {
      state: field(sensor, "state", `${path}.sensor`, enumReader(SENSOR_STATES)),
      fault: field(sensor, "fault", `${path}.sensor`, nullable(enumReader(SENSOR_FAULTS))),
      quality: field(sensor, "quality", `${path}.sensor`, numberReader({ min: 0, max: 1 })),
    },
    hazards: field(source, "hazards", path, arrayOf(readHazard)),
    hypotheses: field(source, "hypotheses", path, arrayOf(readHypothesis)),
    last_replan_reason: field(source, "last_replan_reason", path, nullable(readString)),
    last_replan_detection_id: field(source, "last_replan_detection_id", path, nullable(readString)),
    planner_requests: field(source, "planner_requests", path, numberReader({ min: 0 }, true)),
  };
};

export function parseSnapshot(raw: unknown): MissionSnapshot {
  const path = "state";
  const source = readObject(raw, path);
  const schemaVersion = field(source, "schema_version", path, readString);
  if (!schemaVersion.startsWith("1.")) {
    throw new ContractError(`Неподдерживаемая версия схемы состояния: ${schemaVersion}`);
  }
  const unitInterval = numberReader({ min: 0, max: 1 });
  const nonNegative = numberReader({ min: 0 });
  return {
    schema_version: schemaVersion,
    run_id: field(source, "run_id", path, nullable(readString)),
    revision: field(source, "revision", path, numberReader({ min: 0 }, true)),
    status: field(source, "status", path, readRunStatus),
    scenario: field(source, "scenario", path, nullable(enumReader(SCENARIOS))),
    seed: field(source, "seed", path, nullable(numberReader({}, true))),
    judge_mode: field(source, "judge_mode", path, enumReader(["local", "official"] as const)),
    planner_mode: field(source, "planner_mode", path, enumReader(["llm", "fallback"] as const)),
    simulation_time_s: field(source, "simulation_time_s", path, nullable(nonNegative)),
    map_id: field(source, "map_id", path, nullable(readString)),
    robot_pose: field(
      source,
      "robot_pose",
      path,
      nullable((value, poseTarget) => {
        const pose = readObject(value, poseTarget);
        return { ...readPoint(pose, poseTarget), heading_rad: field(pose, "heading_rad", poseTarget, readNumber) };
      }),
    ),
    base_position: field(source, "base_position", path, nullable(readPoint)),
    battery_remaining: field(source, "battery_remaining", path, nullable(nonNegative)),
    battery_initial: field(source, "battery_initial", path, numberReader({ greaterThan: 0 })),
    sample_signal: field(source, "sample_signal", path, nullable(unitInterval)),
    samples_collected: field(source, "samples_collected", path, numberReader({ min: 0 }, true)),
    return_energy_estimate: field(source, "return_energy_estimate", path, nullable(nonNegative)),
    current_goal: field(source, "current_goal", path, nullable(readGoal)),
    trajectory: field(source, "trajectory", path, arrayOf(readPoint)),
    planned_path: field(source, "planned_path", path, arrayOf(readPoint)),
    collected_samples: field(
      source,
      "collected_samples",
      path,
      arrayOf((value, itemPath) => {
        const item = readObject(value, itemPath);
        return {
          sample_id: field(item, "sample_id", itemPath, readString),
          position: field(item, "position", itemPath, readPoint),
        };
      }),
    ),
    terrain_estimates: field(
      source,
      "terrain_estimates",
      path,
      arrayOf((value, itemPath) => {
        const item = readObject(value, itemPath);
        return {
          region_id: field(item, "region_id", itemPath, readString),
          center: field(item, "center", itemPath, readPoint),
          radius_m: field(item, "radius_m", itemPath, numberReader({ greaterThan: 0 })),
          energy_per_m: field(item, "energy_per_m", itemPath, nonNegative),
          confidence: field(item, "confidence", itemPath, unitInterval),
          std_energy_per_m: optionalField(item, "std_energy_per_m", itemPath, nullable(nonNegative), null),
          regime: optionalField(item, "regime", itemPath, numberReader({ min: 0 }, true), 0),
          last_measured_s: optionalField(item, "last_measured_s", itemPath, nullable(nonNegative), null),
        };
      }),
    ),
    last_error: field(source, "last_error", path, nullable(readErrorInfo)),
    mission_text: optionalField(source, "mission_text", path, readString, ""),
    target_samples: optionalField(source, "target_samples", path, nullable(numberReader({ min: 1 }, true)), null),
    plan: optionalField(source, "plan", path, nullable(readPlan), null),
    research: optionalField(source, "research", path, nullable(readResearch), null),
  };
}

export function parseHealth(raw: unknown): HealthStatus {
  const path = "health";
  const source = readObject(raw, path);
  return {
    status: field(source, "status", path, enumReader(["ready", "starting"] as const)),
    ros_connected: field(source, "ros_connected", path, readBoolean),
    judge_mode: field(source, "judge_mode", path, enumReader(["local", "official"] as const)),
    llm_available: field(source, "llm_available", path, readBoolean),
    supported_scenarios:
      source.supported_scenarios === undefined
        ? ["easy"]
        : field(source, "supported_scenarios", path, arrayOf(enumReader(SCENARIOS))),
  };
}

export function parseMap(raw: unknown): MapData {
  const path = "map";
  const source = readObject(raw, path);
  const width = field(source, "width", path, numberReader({ greaterThan: 0 }, true));
  const height = field(source, "height", path, numberReader({ greaterThan: 0 }, true));
  const cells = field(source, "cells", path, arrayOf(numberReader({ min: -1, max: 100 }, true)));
  if (cells.length !== width * height) {
    throw new ContractError(
      `Некорректный ответ сервера: map.cells содержит ${cells.length} клеток, ожидается ${width * height}`,
    );
  }
  const originSource = field(source, "origin", path, readObject);
  return {
    map_id: field(source, "map_id", path, readString),
    resolution_m: field(source, "resolution_m", path, numberReader({ greaterThan: 0 })),
    width,
    height,
    origin: {
      position_x_m: field(originSource, "position_x_m", "map.origin", readNumber),
      position_y_m: field(originSource, "position_y_m", "map.origin", readNumber),
      heading_rad: field(originSource, "heading_rad", "map.origin", readNumber),
    },
    cells,
  };
}

const readJournalEntry: Reader<JournalEntry> = (value, path) => {
  const source = readObject(value, path);
  return {
    sequence: field(source, "sequence", path, numberReader({ min: 1 }, true)),
    simulation_time_s: field(source, "simulation_time_s", path, nullable(numberReader({ min: 0 }))),
    kind: field(
      source,
      "kind",
      path,
      enumReader(["observation", "hypothesis", "experiment", "decision", "outcome", "error"] as const),
    ),
    title: field(source, "title", path, readString),
    detail: field(source, "detail", path, readString),
    hypothesis_id: field(source, "hypothesis_id", path, nullable(readString)),
    expected: field(source, "expected", path, nullable(readString)),
    observed: field(source, "observed", path, nullable(readString)),
    conclusion: field(source, "conclusion", path, nullable(readString)),
    experiment_id: optionalField(source, "experiment_id", path, nullable(readString), null),
    detection_id: optionalField(source, "detection_id", path, nullable(readString), null),
    plan_id: optionalField(source, "plan_id", path, nullable(readString), null),
    evidence: optionalField(source, "evidence", path, readStrings, []),
  };
};

export function parseJournalPage(raw: unknown): JournalPage {
  const path = "journal";
  const source = readObject(raw, path);
  return {
    run_id: field(source, "run_id", path, readString),
    entries: field(source, "entries", path, arrayOf(readJournalEntry)),
    next_sequence: field(source, "next_sequence", path, numberReader({ min: 0 }, true)),
    has_more: field(source, "has_more", path, readBoolean),
  };
}

export function parseErrorBody(raw: unknown): ErrorInfo | null {
  try {
    return field(readObject(raw, "response"), "error", "response", readErrorInfo);
  } catch {
    return null;
  }
}
