import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, RequestTimeoutError } from "../src/application/errors";
import { MissionController } from "../src/application/missionController";
import type { MissionSnapshot } from "../src/domain/contract";
import { isMapMismatch } from "../src/domain/presentation";
import {
  ControlledGateway,
  FakeScheduler,
  entry,
  exampleMap,
  flush,
  idle,
  readyHealth,
  snapshotWith,
} from "./support";

interface Harness {
  gateway: ControlledGateway;
  scheduler: FakeScheduler;
  controller: MissionController;
  notifications: { count: number };
}

function create(): Harness {
  const gateway = new ControlledGateway();
  const scheduler = new FakeScheduler();
  let counter = 0;
  const controller = new MissionController({ gateway, scheduler, generateId: () => `req-${(counter += 1)}` });
  const notifications = { count: 0 };
  controller.subscribe(() => {
    notifications.count += 1;
  });
  return { gateway, scheduler, controller, notifications };
}

const lastOf = <T,>(items: T[]): T => items[items.length - 1] as T;

async function answerState(harness: Harness, snapshot: MissionSnapshot): Promise<void> {
  lastOf(harness.gateway.stateCalls).deferred.resolve(snapshot);
  await flush();
}

async function failState(harness: Harness, error: unknown = new NetworkError()): Promise<void> {
  lastOf(harness.gateway.stateCalls).deferred.reject(error);
  await flush();
}

/** Запускает контроллер и отвечает на первые запросы: здоровье, карта, состояние. */
async function boot(initial: MissionSnapshot = idle()): Promise<Harness> {
  const harness = create();
  harness.controller.start();
  harness.gateway.healthCalls[0]?.deferred.resolve(readyHealth);
  harness.gateway.mapCalls[0]?.deferred.resolve(exampleMap());
  await flush();
  await answerState(harness, initial);
  return harness;
}

const runA = (patch: Partial<MissionSnapshot> = {}) =>
  snapshotWith({ run_id: "run-a", revision: 10, status: "running", ...patch });

describe("опрос состояния", () => {
  it("не запускает параллельные запросы состояния", async () => {
    const harness = create();
    harness.controller.start();
    await harness.scheduler.advance(5000);
    expect(harness.gateway.stateCalls).toHaveLength(1);
    await answerState(harness, idle());
    await harness.scheduler.advance(500);
    expect(harness.gateway.stateCalls).toHaveLength(2);
    await harness.scheduler.advance(2000);
    expect(harness.gateway.stateCalls).toHaveLength(2);
  });

  it("ответ с меньшей revision не откатывает состояние", async () => {
    const harness = await boot(runA({ revision: 12 }));
    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 5, battery_remaining: 1 }));
    const view = harness.controller.getView();
    expect(view.snapshot?.revision).toBe(12);
    expect(view.snapshot?.battery_remaining).not.toBe(1);
    expect(view.connection).toBe("live");
  });

  it("смена прогона очищает журнал и выбранную гипотезу; поздний ответ старого прогона не возвращает записи", async () => {
    const harness = await boot(runA());
    const oldJournal = lastOf(harness.gateway.journalCalls);
    expect(oldJournal.runId).toBe("run-a");
    oldJournal.deferred.resolve({ run_id: "run-a", entries: [entry(1, { hypothesis_id: "h1" })], next_sequence: 1, has_more: false });
    await flush();
    harness.controller.selectHypothesis("h1");
    expect(harness.controller.getView().journal.entries).toHaveLength(1);

    await harness.scheduler.advance(500);
    // журнал старого прогона запрошен снова и ещё не вернулся
    const pendingOld = lastOf(harness.gateway.journalCalls);
    await answerState(harness, snapshotWith({ run_id: "run-b", revision: 1, status: "starting" }));
    const view = harness.controller.getView();
    expect(view.journal.runId).toBe("run-b");
    expect(view.journal.entries).toEqual([]);
    expect(view.selectedHypothesisId).toBeNull();

    pendingOld.deferred.resolve({ run_id: "run-a", entries: [entry(2)], next_sequence: 2, has_more: false });
    await flush();
    expect(harness.controller.getView().journal.entries).toEqual([]);
    expect(harness.controller.getView().journal.runId).toBe("run-b");
  });

  it("ошибка → устаревание через 3 с → восстановление", async () => {
    const harness = await boot(runA());
    await harness.scheduler.advance(500);
    await failState(harness);
    expect(harness.controller.getView().connection).toBe("live");
    await harness.scheduler.advance(2000);
    await failState(harness);
    await harness.scheduler.advance(600);
    const stale = harness.controller.getView();
    expect(stale.connection).toBe("stale");
    expect(stale.snapshot?.run_id).toBe("run-a");
    expect(stale.connectionError).toContain("Нет связи");

    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 11 }));
    const recovered = harness.controller.getView();
    expect(recovered.connection).toBe("live");
    expect(recovered.snapshot?.revision).toBe(11);
    // опрос продолжается после восстановления
    const callsBefore = harness.gateway.stateCalls.length;
    await harness.scheduler.advance(500);
    expect(harness.gateway.stateCalls.length).toBe(callsBefore + 1);
  });

  it("пауза часов симуляции не означает потерю связи", async () => {
    const harness = await boot(runA({ simulation_time_s: 18.5 }));
    for (let tick = 0; tick < 12; tick += 1) {
      await harness.scheduler.advance(500);
      await answerState(harness, runA({ simulation_time_s: 18.5 }));
    }
    expect(harness.controller.getView().connection).toBe("live");
  });

  it("dispose освобождает таймеры, отменяет запросы и игнорирует поздние ответы", async () => {
    const harness = await boot(runA());
    await harness.scheduler.advance(500);
    const pendingState = lastOf(harness.gateway.stateCalls);
    harness.controller.dispose();
    expect(harness.scheduler.pendingTimers).toBe(0);
    expect(pendingState.signal?.aborted).toBe(true);
    const before = harness.notifications.count;
    pendingState.deferred.resolve(runA({ revision: 99 }));
    await flush();
    expect(harness.notifications.count).toBe(before);
    expect(harness.controller.getView().snapshot?.revision).toBe(10);
    expect(harness.scheduler.pendingTimers).toBe(0);
  });

  it("повторный start после dispose работает (StrictMode)", async () => {
    const harness = await boot();
    harness.controller.dispose();
    harness.controller.start();
    const call = lastOf(harness.gateway.stateCalls);
    call.deferred.resolve(runA());
    await flush();
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a");
  });
});

describe("карта", () => {
  it("несовпадение map_id видно до загрузки подходящей карты, затем карта подгружается", async () => {
    const harness = await boot(idle());
    await harness.scheduler.advance(500);
    await answerState(harness, snapshotWith({ run_id: "run-a", revision: 3, map_id: "map-v2" }));
    let view = harness.controller.getView();
    expect(isMapMismatch(view.snapshot, view.map)).toBe(true);
    const mapCalls = harness.gateway.mapCalls.length;

    await harness.scheduler.advance(2000);
    await answerState(harness, snapshotWith({ run_id: "run-a", revision: 4, map_id: "map-v2" }));
    expect(harness.gateway.mapCalls.length).toBe(mapCalls + 1);
    lastOf(harness.gateway.mapCalls).deferred.resolve({ ...exampleMap(), map_id: "map-v2" });
    await flush();
    view = harness.controller.getView();
    expect(isMapMismatch(view.snapshot, view.map)).toBe(false);
  });
});

describe("команды", () => {
  it("двойной клик Start создаёт одну команду", async () => {
    const harness = await boot();
    const first = harness.controller.startRun(42);
    const second = harness.controller.startRun(42);
    await flush();
    expect(harness.gateway.startCalls).toHaveLength(1);
    expect(harness.gateway.startCalls[0]?.request).toEqual({ request_id: "req-1", scenario: "easy", seed: 42 });
    lastOf(harness.gateway.startCalls).deferred.resolve(runA({ revision: 1, status: "starting" }));
    await Promise.all([first, second]);
    expect(harness.controller.getView().command.phase).toBe("idle");
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a");
  });

  it("Start недоступен без готовности среды и без свежей связи", async () => {
    const harness = create();
    harness.controller.start();
    await answerState(harness, idle());
    await harness.controller.startRun(1);
    expect(harness.gateway.startCalls).toHaveLength(0); // здоровье ещё неизвестно
  });

  it("202 с прежним состоянием ждёт перехода; успех не рисуется до состояния", async () => {
    const harness = await boot();
    const pending = harness.controller.startRun(7);
    lastOf(harness.gateway.startCalls).deferred.resolve(idle());
    await pending;
    expect(harness.controller.getView().command.phase).toBe("awaiting");
    expect(harness.controller.getView().snapshot?.status).toBe("idle");

    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 1, status: "starting" }));
    expect(harness.controller.getView().command.phase).toBe("idle");
    expect(harness.controller.getView().snapshot?.status).toBe("starting");
  });

  it("ожидание перехода не блокирует навсегда", async () => {
    const harness = await boot();
    const pending = harness.controller.startRun(7);
    lastOf(harness.gateway.startCalls).deferred.resolve(idle());
    await pending;
    for (let tick = 0; tick < 25; tick += 1) {
      await harness.scheduler.advance(500);
      await answerState(harness, idle());
    }
    expect(harness.controller.getView().command.phase).toBe("failed");
  });

  it("неизвестный итог после таймаута: сверка с /state, повтор с тем же request_id", async () => {
    const harness = await boot();
    const pending = harness.controller.startRun(5);
    lastOf(harness.gateway.startCalls).deferred.reject(new RequestTimeoutError());
    await pending;
    expect(harness.controller.getView().command).toMatchObject({ phase: "unknown", canRetry: false });
    await harness.controller.retryCommand();
    expect(harness.gateway.startCalls).toHaveLength(1); // до сверки повтор запрещён

    await harness.scheduler.advance(500);
    await answerState(harness, idle()); // состояние сверено: прогона нет
    expect(harness.controller.getView().command.canRetry).toBe(true);

    const retry = harness.controller.retryCommand();
    await flush();
    expect(harness.gateway.startCalls).toHaveLength(2);
    expect(harness.gateway.startCalls[1]?.request).toEqual(harness.gateway.startCalls[0]?.request);
    lastOf(harness.gateway.startCalls).deferred.resolve(runA({ revision: 1, status: "starting" }));
    await retry;
    expect(harness.controller.getView().command.phase).toBe("idle");
  });

  it("после разрыва сначала сверяется /state: принятый backend запуск подтверждается без повтора", async () => {
    const harness = await boot();
    const pending = harness.controller.startRun(5);
    lastOf(harness.gateway.startCalls).deferred.reject(new NetworkError());
    await pending;
    await harness.scheduler.advance(500);
    await failState(harness);
    await harness.scheduler.advance(3000);
    await failState(harness);
    expect(harness.controller.getView().connection).toBe("stale");
    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 2 }));
    expect(harness.controller.getView().command.phase).toBe("idle");
    expect(harness.gateway.startCalls).toHaveLength(1); // старые команды не воспроизводятся автоматически
  });

  it.each([
    [409, "Конфликт"],
    [422, "Запрос отклонён"],
    [503, "Среда не готова"],
  ])("ошибка %i даёт читаемое сообщение и позволяет повторить", async (status, prefix) => {
    const harness = await boot();
    const pending = harness.controller.startRun(5);
    lastOf(harness.gateway.startCalls).deferred.reject(new ApiError(status, "code", "детали", true));
    await pending;
    const { command } = harness.controller.getView();
    expect(command.phase).toBe("failed");
    expect(command.message).toContain(prefix);
    const again = harness.controller.startRun(5);
    await flush();
    expect(harness.gateway.startCalls).toHaveLength(2);
    expect(harness.gateway.startCalls[1]?.request.request_id).not.toBe(harness.gateway.startCalls[0]?.request.request_id);
    lastOf(harness.gateway.startCalls).deferred.resolve(runA({ revision: 1, status: "starting" }));
    await again;
  });

  it("Stop отправляет прерывание один раз и ждёт состояния stopping/stopped", async () => {
    const harness = await boot(runA());
    const first = harness.controller.stopRun();
    const second = harness.controller.stopRun();
    await flush();
    expect(harness.gateway.stopCalls).toHaveLength(1);
    expect(harness.gateway.stopCalls[0]).toMatchObject({ runId: "run-a" });
    lastOf(harness.gateway.stopCalls).deferred.resolve(runA({ revision: 11 }));
    await Promise.all([first, second]);
    expect(harness.controller.getView().command.phase).toBe("awaiting");
    await harness.controller.stopRun();
    expect(harness.gateway.stopCalls).toHaveLength(1);

    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 12, status: "stopping" }));
    expect(harness.controller.getView().command.phase).toBe("idle");
    await harness.scheduler.advance(500);
    await answerState(harness, runA({ revision: 13, status: "stopped" }));
    expect(harness.controller.getView().snapshot?.status).toBe("stopped");
  });

  it("запоздавший ответ состояния, отправленный до команды, не откатывает новый прогон", async () => {
    const harness = await boot();
    await harness.scheduler.advance(500);
    const slowPoll = lastOf(harness.gateway.stateCalls); // отправлен до Start
    const pending = harness.controller.startRun(3);
    lastOf(harness.gateway.startCalls).deferred.resolve(runA({ revision: 1, status: "starting" }));
    await pending;
    slowPoll.deferred.resolve(idle());
    await flush();
    expect(harness.controller.getView().snapshot?.run_id).toBe("run-a");
  });
});
