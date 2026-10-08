import { NetworkError } from "../../src/application/errors"
import { MissionController } from "../../src/application/missionController"
import type { MissionSnapshot } from "../../src/domain/contract"
import {
  ControlledGateway,
  exampleMap,
  FakeScheduler,
  flush,
  idle,
  readyHealth,
  snapshotWith,
} from "../support"

export interface Harness {
  gateway: ControlledGateway
  scheduler: FakeScheduler
  controller: MissionController
  notifications: { count: number }
}

export function create(): Harness {
  const gateway = new ControlledGateway()
  const scheduler = new FakeScheduler()
  let counter = 0
  const controller = new MissionController({
    gateway,
    scheduler,
    generateId: () => {
      counter += 1
      return `req-${counter}`
    },
  })
  const notifications = { count: 0 }
  controller.subscribe(() => {
    notifications.count += 1
  })
  return { gateway, scheduler, controller, notifications }
}

export const lastOf = <T>(items: T[]): T => items[items.length - 1] as T

export async function answerState(harness: Harness, snapshot: MissionSnapshot): Promise<void> {
  lastOf(harness.gateway.stateCalls).deferred.resolve(snapshot)
  await flush()
}

export async function failState(
  harness: Harness,
  error: unknown = new NetworkError(),
): Promise<void> {
  lastOf(harness.gateway.stateCalls).deferred.reject(error)
  await flush()
}

export async function boot(initial: MissionSnapshot = idle()): Promise<Harness> {
  const harness = create()
  harness.controller.start()
  harness.gateway.healthCalls[0]?.deferred.resolve(readyHealth)
  harness.gateway.mapCalls[0]?.deferred.resolve(exampleMap())
  await flush()
  await answerState(harness, initial)
  return harness
}

export const runA = (patch: Partial<MissionSnapshot> = {}) =>
  snapshotWith({ run_id: "run-a", revision: 10, status: "running", ...patch })
