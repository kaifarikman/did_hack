import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureMissionGateway } from "../src/adapters/fixture/fixtureGateway";
import { FIXTURE_SCENARIOS, OUTAGE_REQUEST_COUNT, type FixtureScenarioName } from "../src/adapters/fixture/scenarios";
import { NetworkError } from "../src/application/errors";
import type { MissionSnapshot } from "../src/domain/contract";
import { isFinishedStatus } from "../src/domain/presentation";

async function playUntilFinished(gateway: FixtureMissionGateway, limit = 200): Promise<MissionSnapshot[]> {
  const seen: MissionSnapshot[] = [];
  for (let step = 0; step < limit; step += 1) {
    try {
      const snapshot = await gateway.getState();
      seen.push(snapshot);
      if (isFinishedStatus(snapshot.status)) break;
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
    }
  }
  return seen;
}

async function startScenario(name: FixtureScenarioName) {
  const gateway = new FixtureMissionGateway();
  gateway.setScenario(name);
  const first = await gateway.startRun({ request_id: "r1", scenario: "easy", seed: 42 });
  return { gateway, first };
}

describe("демо-сценарии", () => {
  it("успешная миссия: сбор подтверждён до возврата, completed в конце, revision не убывает", async () => {
    const { gateway, first } = await startScenario("success");
    expect(first.status).toBe("starting");
    expect(first.robot_pose).toBeNull();
    const frames = await playUntilFinished(gateway);
    const last = frames[frames.length - 1] as MissionSnapshot;
    expect(last.status).toBe("completed");
    expect(last.samples_collected).toBe(1);
    expect(last.collected_samples).toHaveLength(1);
    expect(frames.some((frame) => frame.status === "returning")).toBe(true);
    frames.reduce((previous, frame) => {
      expect(frame.revision).toBeGreaterThanOrEqual(previous);
      return frame.revision;
    }, 0);
    const firstCollect = frames.findIndex((frame) => frame.samples_collected > 0);
    const firstReturn = frames.findIndex((frame) => frame.status === "returning");
    expect(firstCollect).toBeLessThanOrEqual(firstReturn);
    expect(last.battery_remaining ?? 0).toBeGreaterThan(0);
  });

  it("отказ LLM: планировщик переключается на fallback, миссия завершается", async () => {
    const { gateway } = await startScenario("llm_fallback");
    const frames = await playUntilFinished(gateway);
    expect(frames.some((frame) => frame.planner_mode === "llm")).toBe(true);
    expect(frames.some((frame) => frame.last_error?.code === "llm_timeout")).toBe(true);
    expect(frames[frames.length - 1]?.planner_mode).toBe("fallback");
    expect(frames[frames.length - 1]?.status).toBe("completed");
  });

  it("разрыв связи: серия сбоев длиннее порога устаревания, затем восстановление", async () => {
    const { gateway } = await startScenario("disconnect");
    let failures = 0;
    let finished = false;
    for (let step = 0; step < 200 && !finished; step += 1) {
      try {
        finished = isFinishedStatus((await gateway.getState()).status);
      } catch {
        failures += 1;
      }
    }
    expect(failures).toBe(OUTAGE_REQUEST_COUNT);
    expect(OUTAGE_REQUEST_COUNT * 0.5).toBeGreaterThan(3);
    expect(finished).toBe(true);
  });

  it("ошибка миссии заканчивается failed без подтверждённого успеха", async () => {
    const { gateway } = await startScenario("failed");
    const frames = await playUntilFinished(gateway);
    const last = frames[frames.length - 1] as MissionSnapshot;
    expect(last.status).toBe("failed");
    expect(last.last_error?.code).toBe("ros_connection_lost");
  });

  it("старт отклонён первый раз с 503, второй проходит; повтор того же request_id идемпотентен", async () => {
    const gateway = new FixtureMissionGateway();
    gateway.setScenario("start_rejected");
    await expect(gateway.startRun({ request_id: "a", scenario: "easy", seed: 1 })).rejects.toMatchObject({ status: 503, retryable: true });
    const started = await gateway.startRun({ request_id: "b", scenario: "easy", seed: 1 });
    const repeated = await gateway.startRun({ request_id: "b", scenario: "easy", seed: 1 });
    expect(repeated.run_id).toBe(started.run_id);
  });

  it("ручная остановка: stopping, затем stopped; журнал фиксирует решение", async () => {
    const { gateway, first } = await startScenario("success");
    for (let index = 0; index < 5; index += 1) await gateway.getState();
    const accepted = await gateway.stopRun(first.run_id as string, { request_id: "s1" });
    expect(accepted.status).toBe("running");
    const stopping = await gateway.getState();
    const stopped = await gateway.getState();
    expect([stopping.status, stopped.status]).toEqual(["stopping", "stopped"]);
    const page = await gateway.getJournalPage(first.run_id as string, 0, 200);
    expect(page.entries.some((item) => item.title.includes("Остановка"))).toBe(true);
  });

  it("журнал растёт с кадрами, нумерация непрерывна, пагинация корректна", async () => {
    const { gateway, first } = await startScenario("success");
    await playUntilFinished(gateway);
    const runId = first.run_id as string;
    const all = await gateway.getJournalPage(runId, 0, 200);
    expect(all.entries.map((item) => item.sequence)).toEqual(all.entries.map((_item, index) => index + 1));
    const firstPage = await gateway.getJournalPage(runId, 0, 3);
    expect(firstPage.has_more).toBe(true);
    const rest = await gateway.getJournalPage(runId, firstPage.next_sequence, 200);
    expect([...firstPage.entries, ...rest.entries]).toEqual(all.entries);
  });

  it("гипотеза без вывода остаётся без вывода, пока не выдан вывод", async () => {
    const { gateway, first } = await startScenario("success");
    await playUntilFinished(gateway);
    const page = await gateway.getJournalPage(first.run_id as string, 0, 200);
    const second = page.entries.filter((item) => item.hypothesis_id === "fixture-hypothesis-2");
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((item) => item.conclusion === null)).toBe(true);
  });

  it("перечень сценариев не пуст и совпадает с поддерживаемыми", () => {
    expect(FIXTURE_SCENARIOS.map((item) => item.name)).toEqual(["success", "llm_fallback", "disconnect", "failed", "start_rejected"]);
  });
});

describe("копии общих примеров", () => {
  const shared = new URL("../../context/mvp/examples/", import.meta.url);
  const local = new URL("../src/adapters/fixture/examples/", import.meta.url);
  it.skipIf(!existsSync(shared))("совпадают с context/mvp/examples (npm run sync-examples)", () => {
    for (const name of ["state-idle.json", "state-running.json", "map.json", "journal.json", "error.json"]) {
      expect(JSON.parse(readFileSync(new URL(name, local), "utf8"))).toEqual(JSON.parse(readFileSync(new URL(name, shared), "utf8")));
    }
  });
});
