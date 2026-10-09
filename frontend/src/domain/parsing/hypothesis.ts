import type { HypothesisView } from "../contract"
import {
  field,
  nullable,
  optionalField,
  type Reader,
  readCount,
  readNonNegative,
  readObject,
  readPoint,
  readString,
  readUnitInterval,
} from "./readers"

export const readHypothesis: Reader<HypothesisView> = (value, path) => {
  const source = readObject(value, path)
  return {
    expected_signal: optionalField(
      source,
      "expected_signal",
      path,
      nullable(readUnitInterval),
      null,
    ),
    measured_signal: optionalField(
      source,
      "measured_signal",
      path,
      nullable(readUnitInterval),
      null,
    ),
    baseline_signal: optionalField(
      source,
      "baseline_signal",
      path,
      nullable(readUnitInterval),
      null,
    ),
    measurement_count: optionalField(source, "measurement_count", path, readCount, 0),
    action: optionalField(source, "action", path, nullable(readString), null),
    conclusion: optionalField(source, "conclusion", path, nullable(readString), null),
    expected_energy_per_m: optionalField(
      source,
      "expected_energy_per_m",
      path,
      nullable(readNonNegative),
      null,
    ),
    measured_energy_per_m: optionalField(
      source,
      "measured_energy_per_m",
      path,
      nullable(readNonNegative),
      null,
    ),
    measured_distance_m: optionalField(source, "measured_distance_m", path, readNonNegative, 0),
    confirm_at_least: optionalField(
      source,
      "confirm_at_least",
      path,
      nullable(readNonNegative),
      null,
    ),
    confirm_at_most: optionalField(
      source,
      "confirm_at_most",
      path,
      nullable(readNonNegative),
      null,
    ),
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
