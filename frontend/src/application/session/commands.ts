import type { MissionSnapshot } from "../../domain/contract"
import { msg } from "../../domain/message"
import { describeError, isUnknownOutcome } from "../errorDescription"
import { ApiError } from "../errors"
import { navigationStartDisabledReason } from "../navigation"
import { IDLE_COMMAND, startDisabledReason, stopDisabledReason } from "../viewState"
import {
  awaitsReconciliation,
  buildStartRequest,
  commandState,
  isConfirmed,
  type PendingCommand,
  type StartOptions,
} from "./commandRules"
import type { ControllerSession } from "./session"

interface CommandHooks {
  readonly generateId: () => string
  readonly onSnapshot: (snapshot: MissionSnapshot, seq: number) => void
  readonly onAccepted: () => void
  readonly onMapChanged: () => void
}

export class CommandDispatcher {
  private pending: PendingCommand | null = null

  constructor(
    private readonly session: ControllerSession,
    private readonly hooks: CommandHooks,
  ) {}

  async start(options: StartOptions): Promise<void> {
    const snapshot = this.session.current.snapshot
    if (snapshot === null || startDisabledReason(this.session.current) !== null) return
    const target = options.navigationTarget
    if (
      target != null &&
      (navigationStartDisabledReason(this.session.current) !== null ||
        this.session.current.map?.map_id !== target.map_id ||
        options.scenario !== "easy" ||
        options.mapMode !== "static" ||
        options.robotCount !== 1)
    )
      return
    const requestId = this.hooks.generateId()
    this.pending = {
      kind: "start",
      requestId,
      startBody: buildStartRequest(requestId, options),
      baselineRunId: snapshot.run_id,
      stopRunId: null,
      sentAt: this.session.scheduler.now(),
      failedAtSeq: null,
    }
    await this.dispatch()
  }

  async stop(): Promise<void> {
    const snapshot = this.session.current.snapshot
    if (snapshot === null || snapshot.run_id === null) return
    if (stopDisabledReason(this.session.current) !== null) return
    this.pending = {
      kind: "stop",
      requestId: this.hooks.generateId(),
      startBody: null,
      baselineRunId: snapshot.run_id,
      stopRunId: snapshot.run_id,
      sentAt: this.session.scheduler.now(),
      failedAtSeq: null,
    }
    await this.dispatch()
  }

  async retry(): Promise<void> {
    const { command } = this.session.current
    if (this.pending === null || command.phase !== "unknown" || !command.canRetry) return
    this.pending.sentAt = this.session.scheduler.now()
    this.pending.failedAtSeq = null
    await this.dispatch()
  }

  dismiss(): void {
    if (this.session.current.command.phase === "failed")
      this.session.update({ command: IDLE_COMMAND })
  }

  checkAwaitTimeout(): void {
    const { command } = this.session.current
    const pending = this.pending
    if (command.phase !== "awaiting" || pending === null || command.kind === null) return
    const waited = this.session.scheduler.now() - pending.sentAt
    if (waited < this.session.timing.awaitTimeoutMs) return
    this.pending = null
    this.session.update({
      command: commandState("failed", command.kind, msg("errors:command.unconfirmed")),
    })
  }

  reconcile(snapshot: MissionSnapshot, seq: number): void {
    const pending = this.pending
    const { command } = this.session.current
    if (pending === null || !awaitsReconciliation(command)) return
    if (isConfirmed(pending, snapshot)) {
      this.pending = null
      this.session.update({ command: IDLE_COMMAND })
      return
    }
    const reconciled =
      command.phase === "unknown" &&
      !command.canRetry &&
      pending.failedAtSeq !== null &&
      seq > pending.failedAtSeq
    if (reconciled) {
      this.session.update({
        command: { ...command, message: msg("errors:command.reconciled"), canRetry: true },
      })
    }
  }

  private send(pending: PendingCommand): Promise<MissionSnapshot> {
    const { gateway, signal } = this.session
    if (pending.kind === "start" && pending.startBody !== null) {
      return gateway.startRun(pending.startBody, { signal })
    }
    return gateway.stopRun(
      pending.stopRunId ?? "",
      { request_id: pending.requestId },
      { signal },
    )
  }

  private async dispatch(): Promise<void> {
    const pending = this.pending
    if (pending === null) return
    const session = this.session
    const generation = session.generation
    const seq = session.nextRequestSeq()
    session.update({ command: commandState("sending", pending.kind, null) })
    try {
      const snapshot = await this.send(pending)
      if (!session.isCurrent(generation)) return
      session.markLive()
      this.hooks.onSnapshot(snapshot, seq)
      if (this.pending === pending) this.settle(pending, snapshot)
      this.hooks.onAccepted()
    } catch (error) {
      if (session.isCurrent(generation) && this.pending === pending) this.fail(pending, error)
    }
  }

  private settle(pending: PendingCommand, snapshot: MissionSnapshot): void {
    if (isConfirmed(pending, snapshot)) {
      this.pending = null
      this.session.update({ command: IDLE_COMMAND })
      return
    }
    this.session.update({
      command: commandState("awaiting", pending.kind, msg("errors:command.awaiting")),
    })
  }

  private fail(pending: PendingCommand, error: unknown): void {
    if (isUnknownOutcome(error)) {
      pending.failedAtSeq = this.session.lastRequestSeq
      this.session.update({
        command: commandState(
          "unknown",
          pending.kind,
          msg("errors:command.unknown"),
          describeError(error),
        ),
      })
      return
    }
    this.pending = null
    if (error instanceof ApiError && error.code === "map_changed") this.hooks.onMapChanged()
    this.session.update({ command: commandState("failed", pending.kind, describeError(error)) })
  }
}
