import type { ErrorInfo, Point, RobotPose } from "../contract"

export class ContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContractError"
  }
}

export type Reader<T> = (value: unknown, path: string) => T
export type JsonObject = Record<string, unknown>

const PREVIEW_LENGTH = 40

function describeValue(value: unknown): string {
  if (value === undefined) return "missing field"
  if (value === null) return "null"
  if (typeof value === "string") return `string "${value.slice(0, PREVIEW_LENGTH)}"`
  if (Array.isArray(value)) return "array"
  return typeof value === "object" ? "object" : String(value)
}

export function fail(path: string, expected: string, value: unknown): never {
  throw new ContractError(
    `Invalid server response: ${path} expected ${expected}, got ${describeValue(value)}`,
  )
}

export const readObject: Reader<JsonObject> = (value, path) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "object", value)
  }
  return value as JsonObject
}

export const readString: Reader<string> = (value, path) => {
  if (typeof value !== "string") fail(path, "string", value)
  return value
}

export const readBoolean: Reader<boolean> = (value, path) => {
  if (typeof value !== "boolean") fail(path, "boolean", value)
  return value
}

export interface NumberBounds {
  min?: number
  max?: number
  greaterThan?: number
}

function checkBounds(value: number, path: string, bounds: NumberBounds): void {
  if (bounds.min !== undefined && value < bounds.min)
    fail(path, `number >= ${bounds.min}`, value)
  if (bounds.max !== undefined && value > bounds.max)
    fail(path, `number <= ${bounds.max}`, value)
  if (bounds.greaterThan !== undefined && value <= bounds.greaterThan) {
    fail(path, `number > ${bounds.greaterThan}`, value)
  }
}

export function numberReader(bounds: NumberBounds = {}, integer = false): Reader<number> {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "finite number", value)
    if (integer && !Number.isInteger(value)) fail(path, "integer", value)
    checkBounds(value, path, bounds)
    return value
  }
}

export const readNumber = numberReader()
export const readUnitInterval = numberReader({ min: 0, max: 1 })
export const readNonNegative = numberReader({ min: 0 })
export const readCount = numberReader({ min: 0 }, true)
export const readPositive = numberReader({ greaterThan: 0 })

export function enumReader<T extends string>(allowed: readonly T[]): Reader<T> {
  return (value, path) => {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      fail(path, `one of: ${allowed.join(", ")}`, value)
    }
    return value as T
  }
}

export function nullable<T>(reader: Reader<T>): Reader<T | null> {
  return (value, path) => (value === null ? null : reader(value, path))
}

export function arrayOf<T>(reader: Reader<T>): Reader<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) fail(path, "array", value)
    return value.map((item, index) => reader(item, `${path}[${index}]`))
  }
}

export function field<T>(source: JsonObject, key: string, path: string, reader: Reader<T>): T {
  return reader(source[key], `${path}.${key}`)
}

export function optionalField<T>(
  source: JsonObject,
  key: string,
  path: string,
  reader: Reader<T>,
  fallback: T,
): T {
  return source[key] === undefined ? fallback : field(source, key, path, reader)
}

export const readStrings = arrayOf(readString)

export const readPoint: Reader<Point> = (value, path) => {
  const source = readObject(value, path)
  return {
    position_x_m: field(source, "position_x_m", path, readNumber),
    position_y_m: field(source, "position_y_m", path, readNumber),
  }
}

export const readPose: Reader<RobotPose> = (value, path) => {
  const pose = readObject(value, path)
  return { ...readPoint(pose, path), heading_rad: field(pose, "heading_rad", path, readNumber) }
}

export const readErrorInfo: Reader<ErrorInfo> = (value, path) => {
  const source = readObject(value, path)
  return {
    code: field(source, "code", path, readString),
    message: field(source, "message", path, readString),
    retryable: field(source, "retryable", path, readBoolean),
  }
}
