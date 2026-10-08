import { describe, expect, it } from "vitest";
import { FixtureMissionGateway } from "../src/adapters/fixture/fixtureGateway";
import { HttpMissionGateway } from "../src/adapters/httpGateway";
import { ApiError, NetworkError, RequestTimeoutError } from "../src/application/errors";
import type { MissionGateway } from "../src/application/ports";
import { ContractError } from "../src/domain/validation";
import { exampleJournal, exampleMap, idle, running } from "./support";

/** Мини-сервер поверх fetch: отдаёт общие примеры по путям контракта. */
function exampleFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    "GET /api/v1/state": () => Response.json(idle()),
    "GET /api/v1/map": () => Response.json(exampleMap()),
    "GET /api/v1/health": () =>
      Response.json({ status: "ready", ros_connected: true, judge_mode: "local", llm_available: true }),
    "GET /api/v1/runs/fixture-run-001/journal?after_sequence=0&limit=100": () => Response.json(exampleJournal()),
    ...overrides,
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    return route === undefined ? Response.json({ error: { code: "not_found", message: "нет", retryable: false } }, { status: 404 }) : route();
  }) as typeof fetch;
}

const adapters: Array<[string, () => MissionGateway]> = [
  ["http", () => new HttpMissionGateway({ fetchFn: exampleFetch() })],
  ["fixture", () => new FixtureMissionGateway()],
];

describe("health и профили", () => {
  it("старый backend без supported_scenarios понимается как только easy", async () => {
    const gateway = new HttpMissionGateway({ fetchFn: exampleFetch() });
    expect((await gateway.getHealth()).supported_scenarios).toEqual(["easy"]);
  });

  it("новый backend перечисляет профили; неизвестный профиль — ошибка контракта", async () => {
    const health = (scenarios: unknown) => () =>
      Response.json({ status: "ready", ros_connected: true, judge_mode: "local", llm_available: false, supported_scenarios: scenarios });
    const ok = new HttpMissionGateway({ fetchFn: exampleFetch({ "GET /api/v1/health": health(["easy", "hard"]) }) });
    expect((await ok.getHealth()).supported_scenarios).toEqual(["easy", "hard"]);
    const bad = new HttpMissionGateway({ fetchFn: exampleFetch({ "GET /api/v1/health": health(["extreme"]) }) });
    await expect(bad.getHealth()).rejects.toBeInstanceOf(ContractError);
  });
});

describe.each(adapters)("порт MissionGateway: %s", (_name, create) => {
  it("до первого прогона отдаёт idle с null-позицией робота и батареей", async () => {
    const snapshot = await create().getState();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.run_id).toBeNull();
    expect(snapshot.robot_pose).toBeNull();
    expect(snapshot.battery_remaining).toBeNull();
  });

  it("отдаёт карту общего примера", async () => {
    const map = await create().getMap();
    expect(map).toMatchObject({ map_id: "fixture-map-v1", width: 12, height: 8 });
    expect(map.cells).toEqual(exampleMap().cells);
  });

  it("отдаёт готовность среды", async () => {
    expect((await create().getHealth()).status).toBe("ready");
  });
});

describe("HTTP-адаптер", () => {
  it("читает страницу журнала по относительному /api/v1", async () => {
    const page = await new HttpMissionGateway({ fetchFn: exampleFetch() }).getJournalPage("fixture-run-001", 0, 100);
    expect(page.entries).toHaveLength(3);
    expect(page.has_more).toBe(false);
  });

  it("некорректный снимок даёт ContractError с названием поля", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({ "GET /api/v1/state": () => Response.json({ ...running(), battery_remaining: "много" }) }),
    });
    await expect(gateway.getState()).rejects.toThrow(ContractError);
    await expect(gateway.getState()).rejects.toThrow(/battery_remaining/);
  });

  it("ошибка контракта превращается в ApiError с кодом и retryable", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({
        "GET /api/v1/state": () =>
          Response.json({ error: { code: "environment_not_ready", message: "Ожидаются наблюдения ROS.", retryable: true } }, { status: 503 }),
      }),
    });
    await expect(gateway.getState()).rejects.toMatchObject({ status: 503, code: "environment_not_ready", retryable: true });
    await expect(gateway.getState()).rejects.toBeInstanceOf(ApiError);
  });

  it("не-JSON при ошибке не ломает разбор", async () => {
    const gateway = new HttpMissionGateway({
      fetchFn: exampleFetch({ "GET /api/v1/state": () => new Response("<html>bad gateway</html>", { status: 502 }) }),
    });
    await expect(gateway.getState()).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it("сетевой сбой и таймаут различаются", async () => {
    const failing = new HttpMissionGateway({ fetchFn: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(failing.getState()).rejects.toBeInstanceOf(NetworkError);
    const hanging = new HttpMissionGateway({
      timeoutMs: 20,
      fetchFn: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof fetch,
    });
    await expect(hanging.getState()).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("отправляет тело команды запуска с request_id", async () => {
    let sentBody: unknown;
    const gateway = new HttpMissionGateway({
      fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return Response.json(running(), { status: 202 });
      }) as typeof fetch,
    });
    await gateway.startRun({ request_id: "abc", scenario: "easy", seed: 7 });
    expect(sentBody).toEqual({ request_id: "abc", scenario: "easy", seed: 7 });
  });
});

describe("HTTP-шлюз и D1", () => {
  const target = { position_x_m: -0.75, position_y_m: 0.5, map_id: "fixture-map-v1" };
  const request = { request_id: "n1", scenario: "easy" as const, seed: 7, task_type: "navigation" as const, navigation_target: target };

  it("отправляет navigation_target как есть в POST /runs и читает state 1.4", async () => {
    let sentBody: unknown = null;
    const state = {
      ...structuredClone(running()),
      schema_version: "1.4",
      task_type: "navigation",
      navigation: { target, phase: "pending", target_reached: false, target_reached_at_s: null, arrival_tolerance_m: 0.12 },
    };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(`${init?.method} ${String(input)}`).toBe("POST /api/v1/runs");
      sentBody = JSON.parse(String(init?.body));
      return Response.json(state, { status: 202 });
    }) as typeof fetch;
    const snapshot = await new HttpMissionGateway({ fetchFn }).startRun(request);
    expect(sentBody).toEqual(request);
    expect(snapshot.navigation?.phase).toBe("pending");
  });

  it("ошибки D1 приходят как ApiError с кодом и признаком retryable", async () => {
    const reject = (status: number, code: string, retryable: boolean): typeof fetch =>
      (async () => Response.json({ error: { code, message: "m", retryable } }, { status })) as typeof fetch;
    await expect(new HttpMissionGateway({ fetchFn: reject(422, "navigation_target_unreachable", false) }).startRun(request)).rejects.toMatchObject({
      status: 422,
      code: "navigation_target_unreachable",
      retryable: false,
    });
    await expect(new HttpMissionGateway({ fetchFn: reject(503, "environment_not_ready", true) }).startRun(request)).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
  });
});
