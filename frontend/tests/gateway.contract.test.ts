import { describe, expect, it } from "vitest"
import { FixtureMissionGateway } from "../src/adapters/fixture/fixtureGateway"
import { HttpMissionGateway } from "../src/adapters/httpGateway"
import { ApiError, NetworkError, RequestTimeoutError } from "../src/application/errors"
import type { MissionGateway } from "../src/application/ports"
import { ContractError } from "../src/domain/validation"
import { exampleJournal, exampleMap, idle, running } from "./support"

function exampleFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    "GET /api/v1/state": () => Response.json(idle()),
    "GET /api/v1/map": () => Response.json(exampleMap()),
    "GET /api/v1/health": () =>
      Response.json({
        status: "ready",
        ros_connected: true,
        judge_mode: "local",
        llm_available: true,
      }),
    "GET /api/v1/runs/fixture-run-001/journal?after_sequence=0&limit=100": () =>
      Response.json(exampleJournal()),
    ...overrides,
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`
    const route = routes[key]
    return route === undefined
      ? Response.json(
          { error: { code: "not_found", message: "missing", retryable: false } },
          { status: 404 },
        )
      : route()
  }) as typeof fetch
}

const adapters: Array<[string, () => MissionGateway]> = [
  ["http", () => new HttpMissionGateway({ fetchFn: exampleFetch() })],
  ["fixture", () => new FixtureMissionGateway()],
]

describe("health and profiles", () => {
  it("an old server without supported_scenarios means easy only", async () => {
    const gateway = new HttpMissionGateway({ fetchFn: exampleFetch() })
    expect((await gateway.getHealth()).supported_scenarios).toEqual(["easy"])
  })

  it("a new server lists profiles; an unknown profile is a contract error", async () => {
    const health = (scenarios: unknown) => () =>
      Response.json({
        status: "ready",
        ros_connected: true,
        judge_mode: "local",
        llm_available: false,
        supported_scenarios: scenarios,
      })
    const ok = new HttpMissionGateway({
      fetchFn: exampleFetch({ "GET /api/v1/health": health(["easy", "hard"]) }),
    })
    expect((await ok.getHealth()).supported_scenarios).toEqual(["easy", "hard"])
    const bad = new HttpMissionGateway({
      fetchFn: exampleFetch({ "GET /api/v1/health": health(["extreme"]) }),
    })
    await expect(bad.getHealth()).rejects.toBeInstanceOf(ContractError)
  })
})

describe.each(adapters)("MissionGateway port: %s", (_name, create) => {
  it("before the first run returns idle with a null robot pose and battery", async () => {
    const snapshot = await create().getState()
    expect(snapshot.status).toBe("idle")
    expect(snapshot.run_id).toBeNull()
    expect(snapshot.robot_pose).toBeNull()
    expect(snapshot.battery_remaining).toBeNull()
  })

  it("returns the map of the shared example", async () => {
    const map = await create().getMap()
    expect(map).toMatchObject({ map_id: "fixture-map-v1", width: 12, height: 8 })
    expect(map.cells).toEqual(exampleMap().cells)
  })

  it("returns environment readiness", async () => {
    expect((await create().getHealth()).status).toBe("ready")
  })
})

describe("HTTP adapter", () => {
  it("reads a journal page from the relative /api/v1", async () => {
    const page = await new HttpMissionGateway({ fetchFn: exampleFetch() }).getJournalPage(
      "fixture-run-001",
      0,
      100,
    )
    expect(page.entries).toHaveLength(3)
    expect(page.has_more).toBe(false)
  })

  it("an invalid snapshot gives a ContractError naming the field", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({
        "GET /api/v1/state": () => Response.json({ ...running(), battery_remaining: "plenty" }),
      }),
    })
    await expect(gateway.getState()).rejects.toThrow(ContractError)
    await expect(gateway.getState()).rejects.toThrow(/battery_remaining/)
  })

  it("a contract error becomes an ApiError with code and retryable", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({
        "GET /api/v1/state": () =>
          Response.json(
            {
              error: {
                code: "environment_not_ready",
                message: "Waiting for ROS observations.",
                retryable: true,
              },
            },
            { status: 503 },
          ),
      }),
    })
    await expect(gateway.getState()).rejects.toMatchObject({
      status: 503,
      code: "environment_not_ready",
      retryable: true,
    })
    await expect(gateway.getState()).rejects.toBeInstanceOf(ApiError)
  })

  it("a non-JSON error body does not break parsing", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({
        "GET /api/v1/state": () => new Response("<html>bad gateway</html>", { status: 502 }),
      }),
    })
    await expect(gateway.getState()).rejects.toMatchObject({ status: 502, retryable: true })
  })

  it("a network failure and a timeout are told apart", async () => {
    const failing = new HttpMissionGateway({
      fetchFn: (async () => {
        throw new TypeError("fetch failed")
      }) as typeof fetch,
    })
    await expect(failing.getState()).rejects.toBeInstanceOf(NetworkError)
    const hanging = new HttpMissionGateway({
      timeoutMs: 20,
      fetchFn: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          )
        })) as typeof fetch,
    })
    await expect(hanging.getState()).rejects.toBeInstanceOf(RequestTimeoutError)
  })

  it("sends the start command body with request_id", async () => {
    let sentBody: unknown
    const gateway = new HttpMissionGateway({
      fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body))
        return Response.json(running(), { status: 202 })
      }) as typeof fetch,
    })
    await gateway.startRun({ request_id: "abc", scenario: "easy", seed: 7 })
    expect(sentBody).toEqual({ request_id: "abc", scenario: "easy", seed: 7 })
  })
})
