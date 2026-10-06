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
