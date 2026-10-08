import { describe, expect, it } from "vitest";
import { describeError } from "../src/application/errorMessages";
import { ApiError, NetworkError } from "../src/application/errors";
import { MissionController } from "../src/application/missionController";
import { navigationStartDisabledReason } from "../src/application/viewState";
import type { MapData, MissionSnapshot, NavigationPhase, NavigationView } from "../src/domain/contract";
import {
  canvasClickToWorld,
  cellAtWorld,
  createViewTransform,
  screenToWorld,
  worldToLocal,
  worldToScreen,
} from "../src/domain/geometry";
import {
  EMPTY_DRAFT,
  draftFromPoint,
  evaluateDraft,
  parseCoordinate,
} from "../src/domain/navigationDraft";
import { isGoalLocked, navigationOutcome, navigationStages } from "../src/domain/navigationPresentation";
import { parseHealth, parseSnapshot } from "../src/domain/validation";
import {
  ControlledGateway,
  FakeScheduler,
  exampleMap,
  flush,
  idle,
  readyHealth,
  running,
} from "./support";

// ---------- геометрия клика ----------

function mapWith(patch: Partial<MapData>): MapData {
  return { ...exampleMap(), ...patch };
}

describe("клик по карте → мировая точка", () => {
  const map = exampleMap(); // 12×8, 0.25 м, origin (-2.5; -1): мир x∈[-2.5; 0.5], y∈[-1; 1]

  it("центр холста соответствует центру карты, экранная ось Y перевёрнута", () => {
    const viewport = { width: 600, height: 400 };
    const transform = createViewTransform(map, viewport);
    const center = canvasClickToWorld(transform, viewport, { left: 0, top: 0, width: 600, height: 400 }, { x: 300, y: 200 });
    expect(center?.position_x_m).toBeCloseTo(-1.0, 6);
    expect(center?.position_y_m).toBeCloseTo(0, 6);
    const top = screenToWorld(transform, { x: 300, y: transform.offsetY });
    const bottom = screenToWorld(transform, { x: 300, y: transform.offsetY + 2 * transform.scale });
    expect(top.position_y_m).toBeGreaterThan(bottom.position_y_m);
  });

  it("клик и отрисовка взаимно обратны, в том числе для отрицательных координат", () => {
    const transform = createViewTransform(map, { width: 480, height: 360 });
    for (const point of [
      { position_x_m: -2.4, position_y_m: -0.9 },
      { position_x_m: -0.75, position_y_m: 0.3 },
      { position_x_m: 0.4, position_y_m: 0.95 },
    ]) {
      const back = screenToWorld(transform, worldToScreen(transform, point));
      expect(back.position_x_m).toBeCloseTo(point.position_x_m, 9);
      expect(back.position_y_m).toBeCloseTo(point.position_y_m, 9);
    }
  });

  it("точка не зависит от размера окна: после resize тот же пиксель карты даёт ту же мировую точку", () => {
    const point = { position_x_m: -1.4, position_y_m: 0.2 };
    for (const viewport of [{ width: 300, height: 300 }, { width: 900, height: 450 }, { width: 1400, height: 320 }]) {
      const transform = createViewTransform(map, viewport);
      const screen = worldToScreen(transform, point);
      const world = canvasClickToWorld(transform, viewport, { left: 17, top: 33, width: viewport.width, height: viewport.height }, { x: screen.x + 17, y: screen.y + 33 });
      expect(world?.position_x_m).toBeCloseTo(point.position_x_m, 9);
      expect(world?.position_y_m).toBeCloseTo(point.position_y_m, 9);
    }
  });

  it("devicePixelRatio не влияет: логический размер холста в CSS-пикселях, масштаб страницы учтён через rect", () => {
    const viewport = { width: 600, height: 400 };
    const transform = createViewTransform(map, viewport);
    const point = { position_x_m: -0.5, position_y_m: -0.4 };
    const screen = worldToScreen(transform, point);
    // страница отрисована в половину логического размера (rect = 300×200): клик в пикселях rect
    const scaled = canvasClickToWorld(transform, viewport, { left: 10, top: 20, width: 300, height: 200 }, { x: 10 + screen.x / 2, y: 20 + screen.y / 2 });
    expect(scaled?.position_x_m).toBeCloseTo(point.position_x_m, 9);
    expect(scaled?.position_y_m).toBeCloseTo(point.position_y_m, 9);
  });

  it("клик вне холста или в пустом поле вне карты распознаётся как вне карты", () => {
    const viewport = { width: 600, height: 200 }; // карта вписана по высоте, слева и справа поля
    const transform = createViewTransform(map, viewport);
    const rect = { left: 0, top: 0, width: 600, height: 200 };
    expect(canvasClickToWorld(transform, viewport, rect, { x: -5, y: 10 })).toBeNull();
    const margin = canvasClickToWorld(transform, viewport, rect, { x: 5, y: 100 });
    expect(margin).not.toBeNull();
    expect(cellAtWorld(map, margin as NonNullable<typeof margin>)).toBeNull();
    expect(canvasClickToWorld(transform, viewport, { left: 0, top: 0, width: 0, height: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("карта с поворотом origin: мир ↔ локальные координаты и клетка под точкой согласованы", () => {
    const rotated = mapWith({ origin: { position_x_m: 1, position_y_m: 2, heading_rad: Math.PI / 2 } });
    // локальная точка (0.6; 0.3) при повороте 90° → мир (1 - 0.3; 2 + 0.6)
    const world = { position_x_m: 0.7, position_y_m: 2.6 };
    const local = worldToLocal(rotated.origin, world);
    expect(local.x).toBeCloseTo(0.6, 9);
    expect(local.y).toBeCloseTo(0.3, 9);
    expect(cellAtWorld(rotated, world)).toMatchObject({ column: 2, row: 1 });
  });

  it("границы клеток: левая-нижняя граница входит, правая-верхняя нет", () => {
    expect(cellAtWorld(map, { position_x_m: -2.5, position_y_m: -1 })).toMatchObject({ column: 0, row: 0 });
    expect(cellAtWorld(map, { position_x_m: 0.5, position_y_m: 0 })).toBeNull();
    expect(cellAtWorld(map, { position_x_m: -0.5, position_y_m: 1 })).toBeNull();
    expect(cellAtWorld(map, { position_x_m: Number.NaN, position_y_m: 0 })).toBeNull();
  });
});

// ---------- черновик цели ----------

describe("черновик цели", () => {
  const map = exampleMap();

  it("числа: запятая допустима, мусор и нефинитные значения отклоняются", () => {
    expect(parseCoordinate("-0,75")).toBe(-0.75);
    expect(parseCoordinate(" 1.5 ")).toBe(1.5);
    for (const bad of ["", "abc", "1e3", "Infinity", "NaN", "1..2", "--1", "0x10"]) expect(parseCoordinate(bad)).toBeNull();
  });

  it("пустой, нечисловой, вне карты, с устаревшей картой и готовый черновики различаются", () => {
    expect(evaluateDraft(EMPTY_DRAFT, map, false).problem).toBe("empty");
    expect(evaluateDraft({ xText: "a", yText: "1", mapId: map.map_id }, map, false).problem).toBe("invalid_number");
    expect(evaluateDraft({ xText: "5", yText: "5", mapId: map.map_id }, map, false)).toMatchObject({ problem: "outside_map", target: null });
    expect(evaluateDraft({ xText: "-1", yText: "0", mapId: "old-map" }, map, false).problem).toBe("map_changed");
    expect(evaluateDraft({ xText: "-1", yText: "0", mapId: map.map_id }, map, true).problem).toBe("map_mismatch");
    expect(evaluateDraft({ xText: "-1", yText: "0", mapId: map.map_id }, null, false).problem).toBe("no_map");
    const ready = evaluateDraft({ xText: "-0,75", yText: "0.5", mapId: map.map_id }, map, false);
    expect(ready.problem).toBeNull();
    expect(ready.target).toEqual({ position_x_m: -0.75, position_y_m: 0.5, map_id: map.map_id });
  });

  it("клетка-стена не запрещает отправку, но предупреждает; решение о достижимости остаётся за backend", () => {
    const wall = evaluateDraft({ xText: "-2.4", yText: "0", mapId: map.map_id }, map, false);
    expect(wall.target).not.toBeNull();
    expect(wall.warning).toMatch(/занята/);
  });

  it("клик сохраняет миллиметровую точность и привязывает карту", () => {
    const draft = draftFromPoint({ position_x_m: -0.7500001, position_y_m: 0.30049 }, map.map_id);
    expect(draft).toEqual({ xText: "-0.75", yText: "0.3", mapId: map.map_id });
  });
});

// ---------- контракт state 1.4 ----------

function navigationState(phase: NavigationPhase, patch: Partial<NavigationView> = {}, status: MissionSnapshot["status"] = "running"): unknown {
  const base = structuredClone(running()) as unknown as Record<string, unknown>;
  return {
    ...base,
    schema_version: "1.4",
    status,
    task_type: "navigation",
    navigation: {
      target: { position_x_m: -0.75, position_y_m: 0.5, map_id: "fixture-map-v1" },
      phase,
      target_reached: false,
      target_reached_at_s: null,
      arrival_tolerance_m: 0.12,
      ...patch,
    },
  };
}

describe("контракт D1 в state", () => {
  it("state 1.4 несёт тип задачи и цель", () => {
    const snapshot = parseSnapshot(navigationState("moving_to_target"));
    expect(snapshot.task_type).toBe("navigation");
    expect(snapshot.navigation).toMatchObject({ phase: "moving_to_target", target_reached: false, arrival_tolerance_m: 0.12 });
    expect(snapshot.navigation?.target.map_id).toBe("fixture-map-v1");
  });

  it("старые state 1.0–1.3 читаются как research без навигации", () => {
    const snapshot = parseSnapshot(structuredClone(running()));
    expect(snapshot.schema_version).toBe("1.3");
    expect(snapshot.task_type).toBe("research");
    expect(snapshot.navigation).toBeNull();
    const legacy = structuredClone(running()) as unknown as Record<string, unknown>;
    legacy.schema_version = "1.0";
    expect(parseSnapshot(legacy).task_type).toBe("research");
  });

  it("1.4 строго требует поля задачи, навигация требует объект цели, неизвестная фаза отклоняется", () => {
    const missing = structuredClone(navigationState("moving_to_target")) as Record<string, unknown>;
    delete missing.task_type;
    expect(() => parseSnapshot(missing)).toThrow(/task_type/);
    expect(() => parseSnapshot({ ...(navigationState("moving_to_target") as object), navigation: null })).toThrow(/navigation/);
    expect(() => parseSnapshot(navigationState("flying" as NavigationPhase))).toThrow(/phase/);
    expect(() => parseSnapshot(navigationState("pending", { arrival_tolerance_m: 0 }))).toThrow(/arrival_tolerance_m/);
  });

  it("research в 1.4 имеет navigation = null", () => {
    const research = { ...(structuredClone(running()) as object), schema_version: "1.4", task_type: "research", navigation: null };
    expect(parseSnapshot(research).navigation).toBeNull();
  });

  it("health без supported_task_types значит только research; navigation не предлагается вслепую", () => {
    const { supported_task_types: _ignored, ...legacy } = readyHealth;
    expect(parseHealth(legacy).supported_task_types).toEqual(["research"]);
    expect(parseHealth({ ...legacy, supported_task_types: ["research", "navigation"] }).supported_task_types).toContain("navigation");
    const view = { health: parseHealth(legacy) } as Parameters<typeof navigationStartDisabledReason>[0];
    expect(navigationStartDisabledReason(view)).toMatch(/не объявляет/);
  });
});

// ---------- отображение исхода ----------

describe("цель достигнута ≠ миссия завершена", () => {
  const stateOf = (phase: NavigationPhase, status: MissionSnapshot["status"], patch: Partial<NavigationView> = {}, error: MissionSnapshot["last_error"] = null) =>
    ({ ...parseSnapshot(navigationState(phase, patch, status)), last_error: error }) as MissionSnapshot;

  it("достигнута, возврат идёт: прогресс, а не успех", () => {
    const snapshot = stateOf("returning", "returning", { target_reached: true, target_reached_at_s: 12.5 });
    expect(navigationOutcome(snapshot)).toMatchObject({ kind: "progress" });
    const stages = navigationStages(snapshot);
    expect(stages.find((stage) => stage.id === "reached")?.state).toBe("done");
    expect(stages.find((stage) => stage.id === "return")?.state).toBe("current");
    expect(stages.find((stage) => stage.id === "finish")?.state).toBe("todo");
  });

  it("успех только при completed + finished + достижении цели", () => {
    expect(navigationOutcome(stateOf("finished", "completed", { target_reached: true, target_reached_at_s: 9 }))?.kind).toBe("success");
    expect(navigationOutcome(stateOf("finished", "completed"))?.kind).toBe("warning");
    expect(navigationOutcome(stateOf("moving_to_target", "running"))).toBeNull();
  });

  it("недостигнутая цель после безопасного возврата — отказ, не успех", () => {
    const error = { code: "navigation_goal_not_reached", message: "x", retryable: false };
    const outcome = navigationOutcome(stateOf("failed", "failed", {}, error));
    expect(outcome).toMatchObject({ kind: "failure", title: "Цель не достигнута" });
  });

  it("Stop: прервано; после достижения отмечено, что возврат не завершён", () => {
    expect(navigationOutcome(stateOf("stopped", "stopped"))?.detail).toMatch(/Цель не достигнута/);
    expect(navigationOutcome(stateOf("stopped", "stopped", { target_reached: true }))?.detail).toMatch(/возврат не завершён/);
  });

  it("цель блокируется только пока прогон активен", () => {
    expect(isGoalLocked(null)).toBe(false);
    expect(isGoalLocked(stateOf("pending", "starting"))).toBe(true);
    expect(isGoalLocked(stateOf("moving_to_target", "stopping"))).toBe(true);
    expect(isGoalLocked(stateOf("finished", "completed"))).toBe(false);
  });
});

// ---------- сообщения об ошибках ----------

describe("ошибки D1 понятны человеку", () => {
  const cases: Array<[number, string, RegExp]> = [
    [422, "navigation_target_unreachable", /недостижима/],
    [409, "map_changed", /Карта изменилась/],
    [409, "run_conflict", /Другой прогон|идентификатор/],
    [409, "scenario_unavailable", /easy/],
    [503, "environment_not_ready", /не готова/],
    [422, "invalid_request", /координаты/],
  ];
  it.each(cases)("%i %s", (status, code, pattern) => {
    const message = describeError(new ApiError(status, code, "internal: stack at /usr/lib/ros", false));
    expect(message).toMatch(pattern);
    expect(message).not.toMatch(/internal|stack|ros/i);
  });
});

// ---------- управление ----------

async function boot(snapshot: MissionSnapshot = idle(), health = readyHealth) {
  const gateway = new ControlledGateway();
  const scheduler = new FakeScheduler();
  let counter = 0;
  const controller = new MissionController({ gateway, scheduler, generateId: () => `req-${(counter += 1)}` });
  controller.start();
  gateway.healthCalls[0]?.deferred.resolve(health);
  gateway.mapCalls[0]?.deferred.resolve(exampleMap());
  await flush();
  gateway.stateCalls[0]?.deferred.resolve(snapshot);
  await flush();
  return { gateway, scheduler, controller };
}

const TARGET = { position_x_m: -0.75, position_y_m: 0.5, map_id: "fixture-map-v1" };

describe("запуск навигации через controller", () => {
  it("отправляет ровно выбранную цель, map_id и профиль easy/static/1, без текста миссии", async () => {
    const { gateway, controller } = await boot();
    void controller.startRun(7, "easy", "поехали куда-нибудь", "static", 1, TARGET);
    await flush();
    expect(gateway.startCalls).toHaveLength(1);
    expect(gateway.startCalls[0]?.request).toEqual({
      request_id: "req-1",
      scenario: "easy",
      seed: 7,
      task_type: "navigation",
      navigation_target: TARGET,
    });
  });

  it("исследование не получает новых полей", async () => {
    const { gateway, controller } = await boot();
    void controller.startRun(7, "easy", "", "static", 1);
    await flush();
    expect(gateway.startCalls[0]?.request).toEqual({ request_id: "req-1", scenario: "easy", seed: 7 });
  });

  it("не отправляет навигацию, если backend не объявил поддержку, или карта не та, или профиль не easy/static/1", async () => {
    const legacyHealth = { ...readyHealth, supported_task_types: ["research" as const] };
    const unsupported = await boot(idle(), legacyHealth);
    await unsupported.controller.startRun(7, "easy", "", "static", 1, TARGET);
    expect(unsupported.gateway.startCalls).toHaveLength(0);

    const { gateway, controller } = await boot();
    await controller.startRun(7, "easy", "", "static", 1, { ...TARGET, map_id: "other-map" });
    await controller.startRun(7, "medium", "", "static", 1, TARGET);
    await controller.startRun(7, "easy", "", "slam", 1, TARGET);
    await controller.startRun(7, "easy", "", "static", 2, TARGET);
    expect(gateway.startCalls).toHaveLength(0);
  });

  it("неизвестный исход: повтор с тем же request_id и той же целью только после сверки со state", async () => {
    const { gateway, scheduler, controller } = await boot();
    void controller.startRun(7, "easy", "", "static", 1, TARGET);
    await flush();
    gateway.startCalls[0]?.deferred.reject(new NetworkError());
    await flush();
    expect(controller.getView().command).toMatchObject({ phase: "unknown", canRetry: false });
    await scheduler.advance(500);
    gateway.stateCalls.at(-1)?.deferred.resolve(idle());
    await flush();
    expect(controller.getView().command.canRetry).toBe(true);
    void controller.retryCommand();
    await flush();
    expect(gateway.startCalls).toHaveLength(2);
    expect(gateway.startCalls[1]?.request).toEqual(gateway.startCalls[0]?.request);
  });

  it("map_changed: понятная ошибка, повторная загрузка карты, новый запуск получает новый request_id", async () => {
    const { gateway, controller } = await boot();
    const mapCallsBefore = gateway.mapCalls.length;
    void controller.startRun(7, "easy", "", "static", 1, TARGET);
    await flush();
    gateway.startCalls[0]?.deferred.reject(new ApiError(409, "map_changed", "old", false));
    await flush();
    const command = controller.getView().command;
    expect(command.phase).toBe("failed");
    expect(command.message).toMatch(/Карта изменилась/);
    expect(gateway.mapCalls.length).toBe(mapCallsBefore + 1);
    gateway.mapCalls.at(-1)?.deferred.resolve({ ...exampleMap(), map_id: "fixture-map-v2" });
    await flush();
    expect(controller.getView().map?.map_id).toBe("fixture-map-v2");
    controller.dismissCommandMessage();
    void controller.startRun(7, "easy", "", "static", 1, { ...TARGET, map_id: "fixture-map-v2" });
    await flush();
    expect(gateway.startCalls[1]?.request.request_id).toBe("req-2");
  });

  it("Stop во время движения к цели отправляет остановку текущего прогона", async () => {
    const active = { ...parseSnapshot(navigationState("moving_to_target")), run_id: "run-nav", revision: 3 } as MissionSnapshot;
    const { gateway, controller } = await boot(active);
    void controller.stopRun();
    await flush();
    expect(gateway.stopCalls[0]?.runId).toBe("run-nav");
  });
});
