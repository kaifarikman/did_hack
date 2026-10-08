import type { JournalEntry, MapData, MissionSnapshot, Point } from "../../domain/contract";
import { parseJournalPage, parseMap, parseSnapshot } from "../../domain/validation";
import journalExample from "./examples/journal.json";
import mapExample from "./examples/map.json";
import stateIdleExample from "./examples/state-idle.json";
import stateRunningExample from "./examples/state-running.json";

import type { NavigationFixtureScenario } from "./navigationFixture";

export type FixtureScenarioName =
  | "success"
  | "llm_fallback"
  | "disconnect"
  | "failed"
  | "start_rejected"
  | NavigationFixtureScenario;

export const FIXTURE_SCENARIOS: ReadonlyArray<{ name: FixtureScenarioName; label: string }> = [
  { name: "success", label: "Успешная миссия" },
  { name: "llm_fallback", label: "Отказ LLM → резервный алгоритм" },
  { name: "disconnect", label: "Разрыв связи посреди миссии" },
  { name: "failed", label: "Миссия завершается ошибкой" },
  { name: "start_rejected", label: "Старт отклонён: среда не готова" },
  { name: "nav_success", label: "Навигация: цель → возврат → finish" },
  { name: "nav_not_reached", label: "Навигация: цель не достигнута (энергия)" },
  { name: "nav_map_changed", label: "Навигация: карта изменилась" },
  { name: "nav_refused", label: "Навигация: backend отказал" },
  { name: "nav_disconnect", label: "Навигация: потеря связи (stale)" },
];

export function isNavigationScenario(name: FixtureScenarioName): name is NavigationFixtureScenario {
  return name.startsWith("nav_");
}

/** Номер кадра (с нуля), перед которым в сценарии «disconnect» пропадает связь. */
export const OUTAGE_FRAME_INDEX = 14;
/** Номер кадра, перед которым в навигационном сценарии пропадает связь. */
export const NAVIGATION_OUTAGE_FRAME_INDEX = 6;
/** Число подряд неудачных запросов состояния: при 2 Гц это ~4,5 с, больше порога устаревания 3 с. */
export const OUTAGE_REQUEST_COUNT = 9;

export interface ScriptedJournalEntry {
  atFrame: number;
  entry: Omit<JournalEntry, "sequence">;
}

/** Кадры без run_id/revision: их проставляет адаптер при выдаче. */
export interface FixtureScript {
  frames: MissionSnapshot[];
  journal: ScriptedJournalEntry[];
}

export const idleSnapshot: MissionSnapshot = parseSnapshot(stateIdleExample);
export const fixtureMap: MapData = parseMap(mapExample);
const runningTemplate: MissionSnapshot = parseSnapshot(stateRunningExample);
const exampleEntries = parseJournalPage(journalExample).entries;

const BASE: Point = { position_x_m: -2.0, position_y_m: -0.5 };
/** Скрытая в симуляции точка образца: в снимках появляется только как место подтверждённого сбора. */
const SAMPLE_PLACE: Point = { position_x_m: -0.25, position_y_m: 0.25 };
const TERRAIN_CENTER: Point = { position_x_m: -1.7, position_y_m: -0.5 };
const STEP_M = 0.1;

function point(x: number, y: number): Point {
  return { position_x_m: Number(x.toFixed(3)), position_y_m: Number(y.toFixed(3)) };
}

function distance(first: Point, second: Point): number {
  return Math.hypot(first.position_x_m - second.position_x_m, first.position_y_m - second.position_y_m);
}

/** Маршрут к образцу: на восток вдоль y = -0.5, затем на север. */
function buildOutboundRoute(): Point[] {
  const route: Point[] = [BASE];
  let current = BASE;
  while (current.position_x_m < SAMPLE_PLACE.position_x_m - 1e-9) {
    current = point(Math.min(current.position_x_m + STEP_M, SAMPLE_PLACE.position_x_m), current.position_y_m);
    route.push(current);
  }
  while (current.position_y_m < SAMPLE_PLACE.position_y_m - 1e-9) {
    current = point(current.position_x_m, Math.min(current.position_y_m + STEP_M, SAMPLE_PLACE.position_y_m));
    route.push(current);
  }
  return route;
}

function headingBetween(from: Point, to: Point): number {
  return Math.atan2(to.position_y_m - from.position_y_m, to.position_x_m - from.position_x_m);
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

interface ScenarioParams {
  llmFailsAtFrame: number | null;
  failAtReturnStep: number | null;
}

const PARAMS: Record<Exclude<FixtureScenarioName, NavigationFixtureScenario>, ScenarioParams> = {
  success: { llmFailsAtFrame: null, failAtReturnStep: null },
  disconnect: { llmFailsAtFrame: null, failAtReturnStep: null },
  start_rejected: { llmFailsAtFrame: null, failAtReturnStep: null },
  llm_fallback: { llmFailsAtFrame: 10, failAtReturnStep: null },
  failed: { llmFailsAtFrame: null, failAtReturnStep: 10 },
};

export function buildScript(name: Exclude<FixtureScenarioName, NavigationFixtureScenario>): FixtureScript {
  const params = PARAMS[name];
  const outbound = buildOutboundRoute();
  const returning = [...outbound].reverse();
  const collectFrames = 3;
  const collectStart = outbound.length;
  const returnStart = collectStart + collectFrames;

  const frames: MissionSnapshot[] = [];
  const trajectory: Point[] = [];
  let battery = runningTemplate.battery_initial;

  const frameBase = (index: number): MissionSnapshot => ({
    ...runningTemplate,
    simulation_time_s: index,
    base_position: BASE,
    collected_samples: [],
    terrain_estimates: [],
    last_error: null,
    current_goal: null,
    planned_path: [],
    trajectory: [],
  });

  const llmFailed = (index: number): boolean => params.llmFailsAtFrame !== null && index >= params.llmFailsAtFrame;
  const llmErrorVisible = (index: number): boolean =>
    params.llmFailsAtFrame !== null && index >= params.llmFailsAtFrame && index < params.llmFailsAtFrame + 4;

  // кадр 0: запуск без измерений — пустые значения показываются как «нет данных»
  frames.push({
    ...frameBase(0),
    status: "starting",
    simulation_time_s: null,
    robot_pose: null,
    battery_remaining: null,
    sample_signal: null,
    return_energy_estimate: null,
    planner_mode: "llm",
  });

  const addMovingFrame = (
    index: number,
    route: Point[],
    routeIndex: number,
    phase: "outbound" | "returning",
  ): void => {
    const position = route[routeIndex] ?? BASE;
    const next = route[Math.min(routeIndex + 1, route.length - 1)] ?? position;
    const previousPosition = route[Math.max(routeIndex - 1, 0)] ?? position;
    trajectory.push(position);
    const insideTerrain = distance(position, TERRAIN_CENTER) <= 0.3;
    if (routeIndex > 0) battery -= insideTerrain ? 0.5 : 0.3;
    const signal = Math.max(0, 1 - distance(position, SAMPLE_PLACE) / 2.2);
    const remainingRoute = route.slice(routeIndex);
    const collected = phase === "returning";
    const heading = routeIndex === route.length - 1 ? headingBetween(previousPosition, position) : headingBetween(position, next);
    const goalKind = phase === "returning" ? "return" : signal > 0.8 ? "approach" : "explore";
    const reasons = {
      return: "Образец собран: возвращаемся по проверенному маршруту, пока остаётся запас батареи.",
      approach: "Сигнал образца вырос: приближаемся для подтверждения сбора.",
      explore: "Сравнить расход на соседнем участке до продолжения поиска.",
    };
    frames.push({
      ...frameBase(index),
      status: phase === "returning" ? "returning" : "running",
      planner_mode: llmFailed(index) ? "fallback" : "llm",
      robot_pose: { ...position, heading_rad: round(heading, 3) },
      battery_remaining: round(battery, 2),
      sample_signal: round(signal, 2),
      return_energy_estimate: round(distance(position, BASE) * 0.4 + 0.5, 1),
      current_goal: { kind: goalKind, target: remainingRoute.length > 1 ? (remainingRoute[remainingRoute.length - 1] ?? null) : null, reason: reasons[goalKind] },
      trajectory: trajectory.slice(-500),
      planned_path: remainingRoute.slice(0, 6),
      collected_samples: collected ? [{ sample_id: "sample-1", position: SAMPLE_PLACE }] : [],
      samples_collected: collected ? 1 : 0,
      terrain_estimates:
        index >= 6
          ? [
              {
                region_id: "observed-area-1",
                center: TERRAIN_CENTER,
                radius_m: 0.3,
                energy_per_m: index >= 24 ? 2.0 : 2.1,
                confidence: index >= 24 ? 0.7 : 0.4,
                std_energy_per_m: index >= 24 ? 0.2 : 0.5,
                regime: 0,
                last_measured_s: index,
              },
            ]
          : [],
      last_error: llmErrorVisible(index)
        ? { code: "llm_timeout", message: "LLM не ответил вовремя, используется резервный алгоритм.", retryable: true }
        : null,
    });
  };

  outbound.forEach((_, routeIndex) => addMovingFrame(routeIndex + 1, outbound, routeIndex, "outbound"));
  // outbound занимает кадры 1..outbound.length; кадры сбора стоят на месте образца
  for (let step = 0; step < collectFrames; step += 1) {
    const index = collectStart + 1 + step;
    const collected = step >= 1;
    const last = frames[frames.length - 1] as MissionSnapshot;
    frames.push({
      ...last,
      simulation_time_s: index,
      current_goal: { kind: "collect", target: SAMPLE_PLACE, reason: "Подтверждаем сбор образца у места максимального сигнала." },
      planned_path: [],
      sample_signal: 1,
      battery_remaining: round(battery - 0.2 * (step + 1), 2),
      samples_collected: collected ? 1 : 0,
      collected_samples: collected ? [{ sample_id: "sample-1", position: SAMPLE_PLACE }] : [],
    });
  }
  battery -= 0.2 * collectFrames;

  const returnSteps = params.failAtReturnStep ?? returning.length;
  for (let step = 0; step < returnSteps; step += 1) {
    addMovingFrame(returnStart + 1 + step, returning, step, "returning");
  }

  const last = frames[frames.length - 1] as MissionSnapshot;
  const finalIndex = frames.length;
  if (params.failAtReturnStep !== null) {
    frames.push({
      ...last,
      status: "failed",
      simulation_time_s: finalIndex,
      current_goal: null,
      planned_path: [],
      last_error: { code: "ros_connection_lost", message: "Потеряна связь с ROS во время возврата.", retryable: false },
    });
  } else {
    frames.push({
      ...last,
      status: "completed",
      simulation_time_s: finalIndex,
      robot_pose: { ...BASE, heading_rad: last.robot_pose?.heading_rad ?? 0 },
      current_goal: null,
      planned_path: [],
      return_energy_estimate: 0,
    });
  }

  return { frames, journal: buildJournal(name, params, { collectStart, returnStart, finalIndex }) };
}

function buildJournal(
  name: FixtureScenarioName,
  params: ScenarioParams,
  marks: { collectStart: number; returnStart: number; finalIndex: number },
): ScriptedJournalEntry[] {
  const withoutSequence = (entry: JournalEntry): Omit<JournalEntry, "sequence"> => {
    const { sequence: _sequence, ...rest } = entry;
    return rest;
  };
  const [start, hypothesis, experiment] = exampleEntries.map(withoutSequence);
  const entries: ScriptedJournalEntry[] = [];
  const add = (atFrame: number, entry: Omit<JournalEntry, "sequence"> | undefined) => {
    if (entry !== undefined) entries.push({ atFrame, entry });
  };
  const timed = (
    frame: number,
    entry: Omit<JournalEntry, "sequence" | "simulation_time_s">,
  ): Omit<JournalEntry, "sequence"> => ({ ...entry, simulation_time_s: frame });

  add(0, start);
  if (params.llmFailsAtFrame !== null) {
    add(params.llmFailsAtFrame, {
      simulation_time_s: params.llmFailsAtFrame,
      kind: "error",
      title: "LLM недоступен",
      detail: "Запрос к планировщику завершился таймаутом. Исполнитель переключён на резервный алгоритм.",
      hypothesis_id: null,
      expected: null,
      observed: null,
      conclusion: null,
      experiment_id: null,
      detection_id: null,
      plan_id: null,
      evidence: [],
    });
  }
  add(16, hypothesis);
  add(18, experiment);
  add(22, timed(22, {
    kind: "observation",
    title: "Сравнительная проба завершена",
    detail: "Расход на соседнем участке измерен при сопоставимой скорости.",
    hypothesis_id: "fixture-hypothesis-1",
    expected: null,
    observed: "Соседний участок: 1.4 ед./м.",
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }));
  add(24, timed(24, {
    kind: "outcome",
    title: "Вывод по гипотезе",
    detail: "Гипотеза подтверждена с умеренной уверенностью.",
    hypothesis_id: "fixture-hypothesis-1",
    expected: null,
    observed: null,
    conclusion: "Участок возле базы дороже соседнего: оценка 2.0 ед./м против 1.4 ед./м.",
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }));
  add(marks.collectStart + 2, timed(marks.collectStart + 2, {
    kind: "outcome",
    title: "Сбор подтверждён судьёй",
    detail: "Образец sample-1 засчитан локальным судьёй (демо).",
    hypothesis_id: null,
    expected: null,
    observed: null,
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }));
  add(marks.returnStart + 1, timed(marks.returnStart + 1, {
    kind: "decision",
    title: "Возврат на базу",
    detail: "Запас батареи после сбора достаточен; выбран возврат по проверенному маршруту.",
    hypothesis_id: null,
    expected: null,
    observed: null,
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }));
  add(marks.returnStart + 3, timed(marks.returnStart + 3, {
    kind: "hypothesis",
    title: "Обратный путь дешевле",
    detail: "Предположение: на возврате расход на метр будет ниже из-за уже известного грунта.",
    hypothesis_id: "fixture-hypothesis-2",
    expected: "Расход на метр при возврате ниже 2.0 ед./м.",
    observed: null,
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  }));
  if (name === "failed") {
    add(marks.finalIndex, timed(marks.finalIndex, {
      kind: "error",
      title: "Потеряна связь с ROS",
      detail: "Исполнитель остановил миссию аварийно; возврат не подтверждён.",
      hypothesis_id: null,
      expected: null,
      observed: null,
      conclusion: null,
      experiment_id: null,
      detection_id: null,
      plan_id: null,
      evidence: [],
    }));
  } else {
    add(marks.finalIndex, timed(marks.finalIndex, {
      kind: "outcome",
      title: "Миссия завершена",
      detail: "Робот на базе, судья подтвердил завершение с положительным остатком батареи.",
      hypothesis_id: null,
      expected: null,
      observed: null,
      conclusion: null,
      experiment_id: null,
      detection_id: null,
      plan_id: null,
      evidence: [],
    }));
  }
  return entries.sort((first, second) => first.atFrame - second.atFrame);
}
