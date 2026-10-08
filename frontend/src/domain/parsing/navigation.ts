import { NAVIGATION_PHASES, type NavigationTarget, type NavigationView } from "../contract"
import {
  enumReader,
  field,
  nullable,
  type Reader,
  readBoolean,
  readNonNegative,
  readObject,
  readPoint,
  readPositive,
  readString,
} from "./readers"

const readTarget: Reader<NavigationTarget> = (value, path) => {
  const source = readObject(value, path)
  return { ...readPoint(source, path), map_id: field(source, "map_id", path, readString) }
}
export const readNavigation: Reader<NavigationView> = (value, path) => {
  const source = readObject(value, path)
  return {
    target: field(source, "target", path, readTarget),
    phase: field(source, "phase", path, enumReader(NAVIGATION_PHASES)),
    target_reached: field(source, "target_reached", path, readBoolean),
    target_reached_at_s: field(source, "target_reached_at_s", path, nullable(readNonNegative)),
    arrival_tolerance_m: field(source, "arrival_tolerance_m", path, readPositive),
  }
}
