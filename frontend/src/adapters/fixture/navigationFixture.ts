import type { JournalEntry, MapData, MissionSnapshot, NavigationPhase, NavigationTarget, Point } from "../../domain/contract";
import { cellAtWorld, cellCenterWorld } from "../../domain/geometry";
import { parseSnapshot } from "../../domain/validation";
import stateRunningExample from "./examples/state-running.json";

/** Демо-планировщик и сценарии навигации D1. Не Gazebo и не настоящий backend: только форма контракта. */

export type NavigationFixtureScenario = "nav_success" | "nav_not_reached" | "nav_map_changed" | "nav_refused" | "nav_disconnect";

export const ARRIVAL_TOLERANCE_M = 0.12;
export const NAVIGATION_SCHEMA_VERSION = "1.4";

const template: MissionSnapshot = parseSnapshot(stateRunningExample);

function key(column: number, row: number): string {
  return `${column},${row}`;
}

/** Кратчайший путь по свободным клеткам (4-связность) от базы до клетки цели; null — пути нет. */
export function planGridRoute(map: MapData, from: Point, to: Point): Point[] | null {
  const start = cellAtWorld(map, from);
  const goal = cellAtWorld(map, to);
  if (start === null || goal === null || start.value !== 0 || goal.value !== 0) return null;
  const previous = new Map<string, string | null>([[key(start.column, start.row), null]]);
  const queue: Array<[number, number]> = [[start.column, start.row]];
  for (let head = 0; head < queue.length; head += 1) {
    const [column, row] = queue[head] as [number, number];
    if (column === goal.column && row === goal.row) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = column + dc;
      const nextRow = row + dr;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= map.width || nextRow >= map.height) continue;
      if (map.cells[nextRow * map.width + nextColumn] !== 0) continue;
      const nextKey = key(nextColumn, nextRow);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, key(column, row));
      queue.push([nextColumn, nextRow]);
    }
  }
  if (!previous.has(key(goal.column, goal.row))) return null;
  const cells: string[] = [];
  for (let cursor: string | null | undefined = key(goal.column, goal.row); cursor; cursor = previous.get(cursor)) {
    cells.push(cursor);
  }
  cells.reverse();
  const centers = cells.map((cell) => {
    const [column, row] = cell.split(",").map(Number) as [number, number];
    return cellCenterWorld(map, column, row);
  });
  return [from, ...centers.slice(1, -1), to];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function heading(from: Point, to: Point): number {
  return round(Math.atan2(to.position_y_m - from.position_y_m, to.position_x_m - from.position_x_m));
}

type EntryDraft = Omit<JournalEntry, "sequence">;

function entry(frame: number, kind: JournalEntry["kind"], title: string, detail: string): EntryDraft {
  return {
    simulation_time_s: frame,
    kind,
    title,
    detail,
    hypothesis_id: null,
    expected: null,
    observed: null,
    conclusion: null,
    experiment_id: null,
    detection_id: null,
    plan_id: null,
    evidence: [],
  };
}

export interface NavigationScript {
  frames: MissionSnapshot[];
  journal: Array<{ atFrame: number; entry: EntryDraft }>;
}

export interface NavigationScriptInput {
  scenario: NavigationFixtureScenario;
  target: NavigationTarget;
  route: Point[];
  base: Point;
  mapId: string;
}

/** Кадры: проверка → движение → достижение цели → возврат → finish (или недостигнутая цель). */
export function buildNavigationScript(input: NavigationScriptInput): NavigationScript {
  const { scenario, target, route, base, mapId } = input;
  const notReachedAt = scenario === "nav_not_reached" ? Math.max(Math.floor(route.length / 2), 1) : null;
  const outbound = notReachedAt === null ? route : route.slice(0, notReachedAt + 1);
  const journal: NavigationScript["journal"] = [];
  const frames: MissionSnapshot[] = [];
  let battery = template.battery_initial;
  let tick = 0;
  let reachedAt: number | null = null;
  const trajectory: Point[] = [];

  const frame = (
    status: MissionSnapshot["status"],
    phase: NavigationPhase,
    patch: Partial<MissionSnapshot>,
  ): MissionSnapshot => ({
    ...template,
    schema_version: NAVIGATION_SCHEMA_VERSION,
    status,
    task_type: "navigation",
    map_id: mapId,
    base_position: base,
    simulation_time_s: tick,
    mission_text: "",
    target_samples: null,
    plan: null,
    research: null,
    terrain_estimates: [],
    collected_samples: [],
    samples_collected: 0,
    sample_signal: null,
    return_energy_estimate: null,
    last_error: null,
    current_goal: null,
    planned_path: [],
    trajectory: [...trajectory],
    navigation: {
      target,
      phase,
      target_reached: reachedAt !== null,
      target_reached_at_s: reachedAt,
      arrival_tolerance_m: ARRIVAL_TOLERANCE_M,
    },
    ...patch,
  });

  frames.push(
    frame("starting", "pending", { simulation_time_s: null, robot_pose: null, battery_remaining: null }),
  );
  journal.push({
    atFrame: 0,
    entry: entry(0, "decision", "navigation_target_set", `Пользователь задал точку (${target.position_x_m}; ${target.position_y_m}) на карте ${mapId}.`),
  });

  const move = (
    points: Point[],
    index: number,
    status: MissionSnapshot["status"],
    phase: NavigationPhase,
    kind: "approach" | "return",
    reason: string,
  ): void => {
    tick += 1;
    const position = points[index] as Point;
    const next = points[Math.min(index + 1, points.length - 1)] as Point;
    const previousPoint = points[Math.max(index - 1, 0)] as Point;
    trajectory.push(position);
    if (index > 0) battery -= 0.4;
    const remaining = points.slice(index);
    frames.push(
      frame(status, phase, {
        robot_pose: {
          position_x_m: position.position_x_m,
          position_y_m: position.position_y_m,
          heading_rad: index === points.length - 1 ? heading(previousPoint, position) : heading(position, next),
        },
        battery_remaining: round(battery),
        return_energy_estimate: round(0.4 * (route.length - 1) + 0.5),
        current_goal: { kind, target: remaining.length > 1 ? (remaining[remaining.length - 1] as Point) : null, reason },
        planned_path: remaining.slice(0, 8),
        route_revision: 1,
      }),
    );
  };

  outbound.forEach((_, index) =>
    move(outbound, index, "running", "moving_to_target", "approach", "Подцель маршрута к заданной пользователем точке."),
  );

  if (notReachedAt === null) {
    reachedAt = tick;
    journal.push({
      atFrame: tick,
      entry: entry(tick, "outcome", "navigation_target_reached", "Робот вошёл в допуск прибытия. Это ещё не конец миссии: далее возврат на базу."),
    });
    const last = frames[frames.length - 1] as MissionSnapshot;
    frames[frames.length - 1] = {
      ...last,
      status: "returning",
      navigation: { ...(last.navigation as NonNullable<MissionSnapshot["navigation"]>), phase: "returning", target_reached: true, target_reached_at_s: reachedAt },
      current_goal: { kind: "return", target: base, reason: "Цель достигнута: возврат на базу." },
    };
  } else {
    journal.push({
      atFrame: tick,
      entry: entry(tick, "error", "Энергии не хватает до цели", "Безопасный возврат важнее: цель отмечена недостигнутой."),
    });
  }
  journal.push({
    atFrame: tick,
    entry: entry(tick, "decision", "navigation_return_started", "Возврат на базу начат."),
  });

  const back = [...outbound].reverse();
  back.slice(1).forEach((_, index) =>
    move(back, index + 1, "returning", "returning", "return", "Возврат на базу по проверенному маршруту."),
  );

  tick += 1;
  const last = frames[frames.length - 1] as MissionSnapshot;
  if (notReachedAt === null) {
    frames.push(
      frame("completed", "finished", {
        robot_pose: { ...base, heading_rad: last.robot_pose?.heading_rad ?? 0 },
        battery_remaining: last.battery_remaining,
        trajectory: [...trajectory],
        route_revision: 1,
      }),
    );
    journal.push({ atFrame: tick, entry: entry(tick, "outcome", "Миссия завершена", "Цель достигнута, робот на базе, судья подтвердил finish.") });
  } else {
    frames.push(
      frame("failed", "failed", {
        robot_pose: { ...base, heading_rad: last.robot_pose?.heading_rad ?? 0 },
        battery_remaining: last.battery_remaining,
        last_error: {
          code: "navigation_goal_not_reached",
          message: "Цель не достигнута: энергии недостаточно, выполнен безопасный возврат.",
          retryable: false,
        },
        route_revision: 1,
      }),
    );
    journal.push({ atFrame: tick, entry: entry(tick, "error", "navigation_goal_not_reached", "Безопасный возврат выполнен, цель не достигнута.") });
  }
  return { frames, journal };
}
