import { ApiError, NetworkError, RequestTimeoutError } from "../application/errors"
import type { MissionGateway, RequestOptions } from "../application/ports"
import {
  ContractError,
  parseErrorBody,
  parseHealth,
  parseJournalPage,
  parseMap,
  parseSnapshot,
} from "../domain/validation"

export interface HttpGatewayConfig {
  baseUrl?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  mapTimeoutMs?: number
}

type Parser<T> = (raw: unknown) => T

export class HttpMissionGateway implements MissionGateway {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly mapTimeoutMs: number

  constructor(config: HttpGatewayConfig = {}) {
    this.baseUrl = config.baseUrl ?? "/api/v1"
    this.fetchFn = config.fetchFn ?? ((input, init) => fetch(input, init))
    this.timeoutMs = config.timeoutMs ?? 2500
    this.mapTimeoutMs = config.mapTimeoutMs ?? 10000
  }

  getHealth(options?: RequestOptions) {
    return this.request("GET", "/health", parseHealth, undefined, this.timeoutMs, options)
  }

  getState(options?: RequestOptions) {
    return this.request("GET", "/state", parseSnapshot, undefined, this.timeoutMs, options)
  }

  getMap(options?: RequestOptions) {
    return this.request("GET", "/map", parseMap, undefined, this.mapTimeoutMs, options)
  }

  startRun(request: Parameters<MissionGateway["startRun"]>[0], options?: RequestOptions) {
    return this.request("POST", "/runs", parseSnapshot, request, this.timeoutMs, options)
  }

  stopRun(
    runId: string,
    request: Parameters<MissionGateway["stopRun"]>[1],
    options?: RequestOptions,
  ) {
    const path = `/runs/${encodeURIComponent(runId)}/stop`
    return this.request("POST", path, parseSnapshot, request, this.timeoutMs, options)
  }

  getJournalPage(
    runId: string,
    afterSequence: number,
    limit: number,
    options?: RequestOptions,
  ) {
    const query = `after_sequence=${afterSequence}&limit=${limit}`
    const path = `/runs/${encodeURIComponent(runId)}/journal?${query}`
    return this.request("GET", path, parseJournalPage, undefined, this.timeoutMs, options)
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    parse: Parser<T>,
    body: unknown,
    timeoutMs: number,
    options?: RequestOptions,
  ): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const forwardAbort = () => controller.abort()
    options?.signal?.addEventListener("abort", forwardAbort)
    if (options?.signal?.aborted) controller.abort()

    try {
      let response: Response
      try {
        response = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers:
            body === undefined
              ? { Accept: "application/json" }
              : { Accept: "application/json", "Content-Type": "application/json" },
          body: body === undefined ? null : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch {
        throw timedOut ? new RequestTimeoutError() : new NetworkError()
      }
      const payload = await this.readJson(response, timedOut)
      if (!response.ok) throw this.toApiError(response.status, payload)
      return parse(payload)
    } finally {
      clearTimeout(timer)
      options?.signal?.removeEventListener("abort", forwardAbort)
    }
  }

  private async readJson(response: Response, timedOut: boolean): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      if (timedOut) throw new RequestTimeoutError()
      if (response.ok) throw new ContractError("Invalid server response: body is not JSON")
      return null
    }
  }

  private toApiError(status: number, payload: unknown): ApiError {
    const info = parseErrorBody(payload)
    if (info !== null) return new ApiError(status, info.code, info.message, info.retryable)
    return new ApiError(
      status,
      `http_${status}`,
      `Server returned error ${status}`,
      status >= 500,
    )
  }
}
