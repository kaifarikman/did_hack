import type { FreshnessSet, SourceFreshness } from "../contract"
import {
  field,
  nullable,
  type Reader,
  readBoolean,
  readNonNegative,
  readObject,
} from "./readers"

const readSource: Reader<SourceFreshness> = (value, path) => {
  const source = readObject(value, path)
  return {
    age_s: field(source, "age_s", path, nullable(readNonNegative)),
    fresh: field(source, "fresh", path, nullable(readBoolean)),
  }
}
export function unknownFreshness(): FreshnessSet {
  return {
    odom: { age_s: null, fresh: null },
    scan: { age_s: null, fresh: null },
    battery: { age_s: null, fresh: null },
    clock: { age_s: null, fresh: null },
  }
}
export const readFreshness: Reader<FreshnessSet> = (value, path) => {
  const source = readObject(value, path)
  return {
    odom: field(source, "odom", path, readSource),
    scan: field(source, "scan", path, readSource),
    battery: field(source, "battery", path, readSource),
    clock: field(source, "clock", path, readSource),
  }
}
