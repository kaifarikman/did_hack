import { LocalizedError, type Message, type MessageKey, msg } from "../domain/message"
import { ContractError } from "../domain/validation"
import { ApiError, NetworkError, RequestTimeoutError } from "./errors"

export type ErrorKind =
  | "network"
  | "timeout"
  | "contract"
  | "conflict"
  | "rejected"
  | "unavailable"
  | "server"
  | "unknown"

export const KNOWN_API_CODES = [
  "scenario_unavailable",
  "environment_not_ready",
  "invalid_request",
  "run_conflict",
  "run_not_found",
  "map_changed",
  "navigation_target_unreachable",
  "invalid_target",
] as const

export type KnownApiCode = (typeof KNOWN_API_CODES)[number]

const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422
const HTTP_UNAVAILABLE = 503

const API_STATUS_KIND: Readonly<Record<number, ErrorKind>> = {
  [HTTP_CONFLICT]: "conflict",
  [HTTP_UNPROCESSABLE]: "rejected",
  [HTTP_UNAVAILABLE]: "unavailable",
}

const KIND_KEY: Readonly<Record<ErrorKind, MessageKey>> = {
  network: "errors:kind.network",
  timeout: "errors:kind.timeout",
  contract: "errors:kind.contract",
  conflict: "errors:kind.conflict",
  rejected: "errors:kind.rejected",
  unavailable: "errors:kind.unavailable",
  server: "errors:kind.server",
  unknown: "errors:kind.unknown",
}

function isKnownApiCode(code: string): code is KnownApiCode {
  return (KNOWN_API_CODES as readonly string[]).includes(code)
}

export function errorKind(error: unknown): ErrorKind {
  if (error instanceof ApiError) return API_STATUS_KIND[error.status] ?? "server"
  if (error instanceof NetworkError) return "network"
  if (error instanceof RequestTimeoutError) return "timeout"
  if (error instanceof ContractError) return "contract"
  return "unknown"
}

export function describeError(error: unknown): Message {
  if (error instanceof LocalizedError) return error.descriptor
  const detail = error instanceof ApiError ? error.message : ""
  const params = detail === "" ? undefined : { detail }
  if (error instanceof ApiError && isKnownApiCode(error.code)) {
    return msg(`errors:api.${error.code}`, params)
  }
  return msg(KIND_KEY[errorKind(error)], params)
}

export function isUnknownOutcome(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    error instanceof RequestTimeoutError ||
    error instanceof ContractError
  )
}
