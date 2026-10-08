import {
  type ErrorInfo,
  type HealthStatus,
  JOURNAL_KINDS,
  type JournalEntry,
  type JournalPage,
  MAP_MODES,
  type MapData,
  SCENARIOS,
  TASK_TYPES,
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
  readBoolean,
  readCount,
  readErrorInfo,
  readNonNegative,
  readNumber,
  readObject,
  readPositive,
  readString,
  readStrings,
} from "./readers"
import { readJudgeMode } from "./snapshot"

const readJournalKind = enumReader(JOURNAL_KINDS)

export function parseHealth(raw: unknown): HealthStatus {
  const path = "health"
  const source = readObject(raw, path)
  return {
    status: field(source, "status", path, enumReader(["ready", "starting"] as const)),
    ros_connected: field(source, "ros_connected", path, readBoolean),
    judge_mode: field(source, "judge_mode", path, readJudgeMode),
    llm_available: field(source, "llm_available", path, readBoolean),
    supported_scenarios: optionalField(
      source,
      "supported_scenarios",
      path,
      arrayOf(enumReader(SCENARIOS)),
      ["easy"],
    ),
    supported_map_modes: optionalField(
      source,
      "supported_map_modes",
      path,
      arrayOf(enumReader(MAP_MODES)),
      ["static"],
    ),
    supported_task_types: optionalField(
      source,
      "supported_task_types",
      path,
      arrayOf(enumReader(TASK_TYPES)),
      ["research"],
    ),
    supported_robot_counts: optionalField(
      source,
      "supported_robot_counts",
      path,
      arrayOf(numberReader({ min: 1 }, true)),
      [1],
    ),
  }
}

export function parseMap(raw: unknown): MapData {
  const path = "map"
  const source = readObject(raw, path)
  const width = field(source, "width", path, numberReader({ greaterThan: 0 }, true))
  const height = field(source, "height", path, numberReader({ greaterThan: 0 }, true))
  const cells = field(source, "cells", path, arrayOf(numberReader({ min: -1, max: 100 }, true)))
  if (cells.length !== width * height) {
    throw new ContractError(
      `Invalid server response: map.cells has ${cells.length} cells, expected ${width * height}`,
    )
  }
  const originPath = "map.origin"
  const origin = field(source, "origin", path, readObject)
  return {
    map_id: field(source, "map_id", path, readString),
    resolution_m: field(source, "resolution_m", path, readPositive),
    width,
    height,
    origin: {
      position_x_m: field(origin, "position_x_m", originPath, readNumber),
      position_y_m: field(origin, "position_y_m", originPath, readNumber),
      heading_rad: field(origin, "heading_rad", originPath, readNumber),
    },
    cells,
  }
}

const readJournalEntry: Reader<JournalEntry> = (value, path) => {
  const source = readObject(value, path)
  return {
    sequence: field(source, "sequence", path, numberReader({ min: 1 }, true)),
    simulation_time_s: field(source, "simulation_time_s", path, nullable(readNonNegative)),
    kind: field(source, "kind", path, readJournalKind),
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
  }
}

export function parseJournalPage(raw: unknown): JournalPage {
  const path = "journal"
  const source = readObject(raw, path)
  return {
    run_id: field(source, "run_id", path, readString),
    entries: field(source, "entries", path, arrayOf(readJournalEntry)),
    next_sequence: field(source, "next_sequence", path, readCount),
    has_more: field(source, "has_more", path, readBoolean),
  }
}

export function parseErrorBody(raw: unknown): ErrorInfo | null {
  try {
    return field(readObject(raw, "response"), "error", "response", readErrorInfo)
  } catch {
    return null
  }
}
