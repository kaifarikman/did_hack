import { describe, expect, it } from "vitest";
import type { MapData } from "../src/domain/contract";
import {
  cellCenterWorld,
  createViewTransform,
  localToScreenMatrix,
  screenToWorld,
  worldToScreen,
} from "../src/domain/geometry";
import {
  buildHypothesisChain,
  buildJournalExport,
  filterJournal,
  mergeJournalEntries,
} from "../src/domain/journal";
import { formatBattery, isMapMismatch, outcomeKind, statusTone } from "../src/domain/presentation";
import { ContractError, parseMap, parseSnapshot } from "../src/domain/validation";
import { entry, exampleMap, idle, running } from "./support";

// асимметричная карта: 4x2 клетки по 0.5 м, origin сдвинут и повёрнут на 90°
const rotatedMap: MapData = {
  map_id: "asym",
  resolution_m: 0.5,
  width: 4,
  height: 2,
  origin: { position_x_m: 10, position_y_m: -3, heading_rad: Math.PI / 2 },
  cells: [0, 0, 0, 0, 0, 0, 100, -1],
};

describe("геометрия карты", () => {
  it("центр клетки учитывает resolution, поворот и смещение origin", () => {
    // клетка (col 3,row 1): локально (1.75, 0.75); поворот на 90°: (-0.75, 1.75); + origin
    const center = cellCenterWorld(rotatedMap, 3, 1);
    expect(center.position_x_m).toBeCloseTo(9.25);
    expect(center.position_y_m).toBeCloseTo(-1.25);
  });

  it("без поворота центр клетки (0,0) — половина resolution от origin", () => {
    const map = exampleMap();
    const center = cellCenterWorld(map, 0, 0);
    expect(center.position_x_m).toBeCloseTo(-2.5 + 0.125);
    expect(center.position_y_m).toBeCloseTo(-1 + 0.125);
  });

  it("экранная ось Y перевёрнута: больший world Y — выше на экране", () => {
    const transform = createViewTransform(exampleMap(), { width: 400, height: 300 });
    const low = worldToScreen(transform, { position_x_m: -1, position_y_m: -0.5 });
    const high = worldToScreen(transform, { position_x_m: -1, position_y_m: 0.5 });
    expect(high.y).toBeLessThan(low.y);
  });

  it("матрица клетки совпадает с worldToScreen для центра клетки повёрнутой карты", () => {
    const transform = createViewTransform(rotatedMap, { width: 500, height: 320 }, 10);
    const matrix = localToScreenMatrix(transform, rotatedMap.origin);
    const localX = (3 + 0.5) * rotatedMap.resolution_m;
    const localY = (1 + 0.5) * rotatedMap.resolution_m;
    const viaMatrix = {
      x: matrix.a * localX + matrix.c * localY + matrix.e,
      y: matrix.b * localX + matrix.d * localY + matrix.f,
    };
    const viaWorld = worldToScreen(transform, cellCenterWorld(rotatedMap, 3, 1));
    expect(viaMatrix.x).toBeCloseTo(viaWorld.x);
    expect(viaMatrix.y).toBeCloseTo(viaWorld.y);
  });

  it("карта помещается в область просмотра и обратное преобразование точно", () => {
    const viewport = { width: 300, height: 500 };
    const transform = createViewTransform(rotatedMap, viewport, 12);
    for (const [column, row] of [[0, 0], [3, 1], [0, 1], [3, 0]] as const) {
      const screen = worldToScreen(transform, cellCenterWorld(rotatedMap, column, row));
      expect(screen.x).toBeGreaterThanOrEqual(12);
      expect(screen.x).toBeLessThanOrEqual(viewport.width - 12);
      expect(screen.y).toBeGreaterThanOrEqual(12);
      expect(screen.y).toBeLessThanOrEqual(viewport.height - 12);
    }
    const point = { position_x_m: 9.4, position_y_m: -2.2 };
    const back = screenToWorld(transform, worldToScreen(transform, point));
    expect(back.position_x_m).toBeCloseTo(point.position_x_m);
    expect(back.position_y_m).toBeCloseTo(point.position_y_m);
  });
});

describe("валидация контракта", () => {
  it("принимает общие примеры и игнорирует неизвестные поля", () => {
    expect(parseSnapshot({ ...structuredClone(running()), extra: 1 }).status).toBe("running");
    expect(parseMap(exampleMap()).cells).toHaveLength(96);
  });

  it("сохраняет null для отсутствующих измерений", () => {
    const snapshot = parseSnapshot(idle());
    expect(snapshot.robot_pose).toBeNull();
    expect(snapshot.battery_remaining).toBeNull();
  });

  it.each([
    ["неизвестный статус", (raw: Record<string, unknown>) => ({ ...raw, status: "flying" })],
    ["отрицательная батарея", (raw: Record<string, unknown>) => ({ ...raw, battery_remaining: -1 })],
    ["сигнал больше 1", (raw: Record<string, unknown>) => ({ ...raw, sample_signal: 1.5 })],
    ["пропущено обязательное поле", (raw: Record<string, unknown>) => ({ ...raw, revision: undefined })],
    ["не конечное число", (raw: Record<string, unknown>) => ({ ...raw, simulation_time_s: Number.NaN })],
    ["чужая версия схемы", (raw: Record<string, unknown>) => ({ ...raw, schema_version: "2.0" })],
  ])("отклоняет снимок: %s", (_name, mutate) => {
    const raw = mutate(structuredClone(running()) as unknown as Record<string, unknown>);
    expect(() => parseSnapshot(raw)).toThrow(ContractError);
  });

  it("сообщение об ошибке называет поле", () => {
    expect(() => parseSnapshot({ ...running(), robot_pose: { position_x_m: "1" } })).toThrow(/robot_pose\.position_x_m/);
  });

  it("schema 1.3 отдаёт идентификатор робота, независимые revisions и freshness источников", () => {
    const snapshot = parseSnapshot(running());
    expect(snapshot.robot_id).toBe("robot_1");
    expect(snapshot.route_revision).toBeGreaterThanOrEqual(0);
    expect(snapshot.plan_revision).toBeGreaterThanOrEqual(0);
    expect(snapshot.freshness.scan.fresh).toBe(true);
  });

  it("мигрирует schema 1.2 к неизвестным freshness и нулевым revision", () => {
    const legacy = structuredClone(running()) as unknown as Record<string, unknown>;
    legacy.schema_version = "1.2";
    delete legacy.robot_id;
    delete legacy.route_revision;
    delete legacy.plan_revision;
    delete legacy.map_revision;
    delete legacy.model_revision;
    delete legacy.freshness;
    const snapshot = parseSnapshot(legacy);
    expect(snapshot.robot_id).toBe("robot_1");
    expect(snapshot.route_revision).toBe(0);
    expect(snapshot.freshness.scan).toEqual({ age_s: null, fresh: null });
  });

  it("schema 1.3 отклоняет некорректную свежесть источника", () => {
    const raw = structuredClone(running()) as { freshness: { scan: { age_s: number; fresh: boolean } } };
    raw.freshness.scan.age_s = -1;
    expect(() => parseSnapshot(raw)).toThrow(/freshness\.scan\.age_s/);
  });

  it("отклоняет карту с неверным числом клеток", () => {
    expect(() => parseMap({ ...exampleMap(), cells: [0, 0] })).toThrow(/cells/);
  });
});

describe("журнал", () => {
  it("объединение удаляет дубликаты и сортирует", () => {
    const merged = mergeJournalEntries([entry(1), entry(3)], [entry(2), entry(3, { title: "дубль" })]);
    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(merged[2]?.title).toBe("Запись 3");
  });

  it("фильтр по типу", () => {
    const entries = [entry(1, { kind: "error" }), entry(2), entry(3, { kind: "error" })];
    expect(filterJournal(entries, "error").map((item) => item.sequence)).toEqual([1, 3]);
    expect(filterJournal(entries, "all")).toHaveLength(3);
  });

  it("цепочка незавершённой гипотезы не выдумывает вывод", () => {
    const entries = [
      entry(1, { kind: "hypothesis", hypothesis_id: "h1", expected: "ниже" }),
      entry(2, { kind: "experiment", hypothesis_id: "h1" }),
      entry(3, { hypothesis_id: "h2", conclusion: "другое" }),
    ];
    const chain = buildHypothesisChain(entries, "h1");
    expect(chain.expectations).toEqual(["ниже"]);
    expect(chain.experiments).toHaveLength(1);
    expect(chain.observations).toEqual([]);
    expect(chain.conclusions).toEqual([]);
  });

  it("экспорт хранит run_id, границу и все записи", () => {
    const result = buildJournalExport("r1", [entry(2), entry(1)], 2);
    expect(result).toMatchObject({ run_id: "r1", last_sequence: 2, entry_count: 2 });
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2]);
  });
});

describe("представление", () => {
  it("батарея — условные единицы, не проценты; нет данных называется прямо", () => {
    expect(formatBattery(55.8, 60)).toBe("55.8 из 60 усл. ед.");
    expect(formatBattery(null, 60)).toContain("нет данных");
    expect(formatBattery(55.8, 60)).not.toContain("%");
  });

  it("только completed считается успехом", () => {
    expect(outcomeKind("completed")).toBe("success");
    expect(outcomeKind("stopped")).toBe("interrupted");
    expect(outcomeKind("failed")).toBe("failure");
    expect(outcomeKind("returning")).toBe("none");
    expect(new Set([statusTone("completed"), statusTone("stopped"), statusTone("failed")]).size).toBe(3);
  });

  it("несовпадение map_id обнаруживается до загрузки нужной карты", () => {
    const snapshot = running();
    expect(isMapMismatch(snapshot, exampleMap())).toBe(false);
    expect(isMapMismatch({ ...snapshot, map_id: "other" }, exampleMap())).toBe(true);
    expect(isMapMismatch(snapshot, null)).toBe(true);
    expect(isMapMismatch({ ...snapshot, map_id: null }, null)).toBe(false);
  });
});
