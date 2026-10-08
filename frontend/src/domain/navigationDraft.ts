import type { MapData, NavigationTarget, Point } from "./contract";
import { cellAtWorld } from "./geometry";

/** Черновик цели: то, что пользователь ввёл или кликнул, но ещё не отправил. */
export interface NavigationDraft {
  xText: string;
  yText: string;
  /** Версия карты, на которой точка выбрана или подтверждена; null, пока точка не выбрана. */
  mapId: string | null;
}

export const EMPTY_DRAFT: NavigationDraft = { xText: "", yText: "", mapId: null };

/** Миллиметровая точность: достаточно для карты 5–25 см и совпадает с тем, что видит пользователь. */
const COORDINATE_DIGITS = 3;

export function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(COORDINATE_DIGITS)));
}

/** Принимает десятичную запятую; пустая строка, текст и нефинитные значения — null. */
export function parseCoordinate(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (normalized === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function draftFromPoint(point: Point, mapId: string | null): NavigationDraft {
  return {
    xText: formatCoordinate(point.position_x_m),
    yText: formatCoordinate(point.position_y_m),
    mapId,
  };
}

export type DraftProblem =
  | "empty"
  | "invalid_number"
  | "no_map"
  | "map_mismatch"
  | "outside_map"
  | "map_changed";

export interface DraftEvaluation {
  /** Точка, которую можно показать на карте (числа корректны), даже если отправка пока запрещена. */
  point: Point | null;
  /** Готова к отправке: числа, карта и версия актуальны. Достижимость решает только backend. */
  target: NavigationTarget | null;
  problem: DraftProblem | null;
  /** Ограничения по карте, не запрещающие отправку (занятая клетка и т. п.). */
  warning: string | null;
}

const PROBLEM_TEXT: Record<DraftProblem, string> = {
  empty: "Укажите точку: введите X и Y или кликните по карте.",
  invalid_number: "X и Y должны быть числами в метрах (например, -0.75).",
  no_map: "Карта ещё не загружена: точку нельзя проверить.",
  map_mismatch: "Карта в интерфейсе не совпадает с состоянием робота: дождитесь обновления карты.",
  outside_map: "Точка вне карты: выберите точку внутри её границ.",
  map_changed: "Карта или связь изменились после выбора точки. Подтвердите точку на актуальной карте.",
};

export function draftProblemText(problem: DraftProblem): string {
  return PROBLEM_TEXT[problem];
}

/**
 * Оценивает черновик против актуальной карты. `mapMismatch` — карта в интерфейсе старее состояния робота.
 * Проверка в интерфейсе ничего не обещает о достижимости: путь проверяет backend при старте.
 */
export function evaluateDraft(draft: NavigationDraft, map: MapData | null, mapMismatch: boolean): DraftEvaluation {
  const blocked = (problem: DraftProblem, point: Point | null = null): DraftEvaluation => ({
    point,
    target: null,
    problem,
    warning: null,
  });
  if (draft.xText.trim() === "" && draft.yText.trim() === "") return blocked("empty");
  const x = parseCoordinate(draft.xText);
  const y = parseCoordinate(draft.yText);
  if (x === null || y === null) return blocked("invalid_number");
  const point: Point = { position_x_m: x, position_y_m: y };
  if (map === null) return blocked("no_map", point);
  if (mapMismatch) return blocked("map_mismatch", point);
  const cell = cellAtWorld(map, point);
  if (cell === null) return blocked("outside_map", point);
  if (draft.mapId !== map.map_id) return blocked("map_changed", point);
  const warning =
    cell.value === 100
      ? "По карте эта клетка занята: backend, скорее всего, отклонит такую цель."
      : cell.value < 0
        ? "По карте эта клетка неизвестна: backend может отклонить такую цель."
        : null;
  return { point, target: { ...point, map_id: map.map_id }, problem: null, warning };
}
