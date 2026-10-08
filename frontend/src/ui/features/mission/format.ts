import type { MissionSnapshot, RunStatus } from "@/domain/contract"
import { outcomeKind } from "@/domain/status"
import type { Formatters } from "@/ui/shared/i18n"
import type { MissionMessage, OutcomeKind } from "./labels"

type MissionFormatters = Pick<Formatters, "number" | "unit">

const BATTERY_DIGITS = 1
const SIGNAL_DIGITS = 2
const TIME_DIGITS = 1

export function batteryRatio(remaining: number | null, initial: number): number | null {
  if (remaining === null || initial <= 0) return null
  return Math.min(Math.max(remaining / initial, 0), 1)
}

export function batteryMessage(
  remaining: number | null,
  initial: number,
  format: MissionFormatters,
): MissionMessage {
  const initialText = format.number(initial, 0)
  if (remaining === null)
    return { key: "mission:value.batteryUnknown", params: { initial: initialText } }
  return {
    key: "mission:value.battery",
    params: { remaining: format.number(remaining, BATTERY_DIGITS), initial: initialText },
  }
}

export function energyMessage(
  value: number | null,
  format: MissionFormatters,
): MissionMessage | null {
  if (value === null) return null
  return {
    key: "mission:value.energy",
    params: { value: format.number(value, BATTERY_DIGITS) },
  }
}

export function samplesMessage(
  collected: number,
  target: number | null,
  format: MissionFormatters,
): MissionMessage {
  const collectedText = format.number(collected, 0)
  if (target === null)
    return { key: "mission:value.samplesOpen", params: { collected: collectedText } }
  return {
    key: "mission:value.samples",
    params: { collected: collectedText, target: format.number(target, 0) },
  }
}

export function simulationTimeText(
  seconds: number | null,
  format: MissionFormatters,
): string | null {
  return seconds === null ? null : format.unit(seconds, "second", TIME_DIGITS)
}

export function signalText(signal: number | null, format: MissionFormatters): string | null {
  return signal === null ? null : format.number(signal, SIGNAL_DIGITS)
}

export function isBelowReturnReserve(snapshot: MissionSnapshot): boolean {
  const { battery_remaining: remaining, return_energy_estimate: reserve } = snapshot
  return remaining !== null && reserve !== null && remaining < reserve
}

export function reserveRatio(snapshot: MissionSnapshot): number | null {
  return batteryRatio(snapshot.return_energy_estimate, snapshot.battery_initial)
}

export function outcomeOf(status: RunStatus): OutcomeKind | null {
  const outcome = outcomeKind(status)
  return outcome === "none" ? null : outcome
}
