#!/usr/bin/env python3
"""Выбор точек для показа на настоящей публичной карте тем же A* и запасом, что использует backend.

  backend/.venv/bin/python scripts/defense/pick_targets.py [--map simulation/judge/data/map.yaml]

Читает только публичную карту (map.yaml/map.pgm) и проектные настройки MissionSettings.
Скрытые образцы и сценарии судьи не читаются. Пишет artifacts/defense/targets.json и
artifacts/defense/targets-map.svg: базу, отобранные цели, маршруты туда/обратно и
отрицательные примеры (стена, вне карты, внутри запаса).

Это офлайн-расчёт. Он не доказывает, что backend примет точку: актуальную карту и позу backend
проверяет сам при старте (контракт D1).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend" / "src"))

from adapters.map_file import load_nav2_map  # noqa: E402
from domain.geometry import Point  # noqa: E402
from domain.grid import FREE, OBSTACLE  # noqa: E402
from domain.pathfinding import find_path  # noqa: E402
from domain.settings import MissionSettings  # noqa: E402

# Кандидаты проверяем на решётке вокруг арены; шаг кратен разрешению карты.
LATTICE_STEP_M = 0.25
ARENA_HALF_SIZE_M = 2.5
# Для пятиминутного показа нужны короткие, но не тривиальные поездки.
MIN_PATH_M = 1.2
MAX_PATH_M = 3.2
# Клик на карте панели ошибается на клетку: цель должна отстоять от запретной зоны с запасом.
TARGET_MARGIN_M = 0.10
# Лидар у статических стен иногда закрывает близкую цель (дефект D1-live-2): держим цели дальше от препятствий.
MIN_OBSTACLE_DISTANCE_M = 0.50
# Оценка поворота на каждой путевой точке: время на разворот при 0.4 рад/с в худшем случае.
TURN_ALLOWANCE_S = 3.0
# Цвета карты арены из context/visual-style.md; запас вокруг препятствий темнее пола.
MAP_COLORS = {"free": "#1A211E", "clearance": "#141A17", "obstacle": "#2C3832"}


def path_length_m(start: Point, waypoints: list[Point]) -> float:
    points = [start, *waypoints]
    return sum(math.dist((a.x_m, a.y_m), (b.x_m, b.y_m)) for a, b in zip(points, points[1:]))


def travel_estimate_s(length_m: float, waypoint_count: int, max_speed_mps: float) -> float:
    return length_m / max_speed_mps + waypoint_count * TURN_ALLOWANCE_S


def lattice(step_m: float, half_size_m: float) -> list[Point]:
    count = int(half_size_m / step_m)
    return [Point(column * step_m, row * step_m)
            for column in range(-count, count + 1) for row in range(-count, count + 1)]


def classify_point(grid, blocked: frozenset[int], point: Point) -> str:
    cell = grid.world_to_cell(point)
    if cell is None:
        return "outside_map"
    value = grid.cells[grid.index(*cell)]
    if value == OBSTACLE:
        return "obstacle"
    if value != FREE:
        return "unknown"
    if grid.index(*cell) in blocked:
        return "inside_clearance"
    return "free"


def has_click_margin(grid, blocked: frozenset[int], point: Point) -> bool:
    """Все клетки в радиусе TARGET_MARGIN_M от цели допустимы для центра робота."""
    column, row = grid.world_to_cell(point)
    radius_cells = math.ceil(TARGET_MARGIN_M / grid.resolution_m)
    for d_column in range(-radius_cells, radius_cells + 1):
        for d_row in range(-radius_cells, radius_cells + 1):
            if math.hypot(d_column, d_row) * grid.resolution_m > TARGET_MARGIN_M + 1e-9:
                continue
            neighbor = (column + d_column, row + d_row)
            if not grid.contains(*neighbor) or grid.index(*neighbor) in blocked:
                return False
    return True


def far_from_obstacles(grid, point: Point) -> bool:
    """В радиусе MIN_OBSTACLE_DISTANCE_M от цели нет клеток препятствий и неизвестного."""
    column, row = grid.world_to_cell(point)
    radius_cells = math.ceil(MIN_OBSTACLE_DISTANCE_M / grid.resolution_m)
    for d_column in range(-radius_cells, radius_cells + 1):
        for d_row in range(-radius_cells, radius_cells + 1):
            if math.hypot(d_column, d_row) * grid.resolution_m > MIN_OBSTACLE_DISTANCE_M:
                continue
            neighbor = (column + d_column, row + d_row)
            if not grid.contains(*neighbor) or grid.cells[grid.index(*neighbor)] != FREE:
                return False
    return True


def route(grid, blocked, start: Point, goal: Point) -> dict | None:
    waypoints = find_path(grid, blocked, start, goal)
    if waypoints is None:
        return None
    return {"waypoints": [[round(p.x_m, 3), round(p.y_m, 3)] for p in waypoints],
            "length_m": round(path_length_m(start, waypoints), 3)}


def pick_spread(candidates: list[dict], count: int) -> list[dict]:
    """Жадно выбирает цели, максимально удалённые друг от друга, чтобы показ не повторялся."""
    chosen = [max(candidates, key=lambda item: item["to_target"]["length_m"])]
    while len(chosen) < count and len(chosen) < len(candidates):
        def separation(item: dict) -> float:
            return min(math.dist(item["target"], other["target"]) for other in chosen)
        chosen.append(max((c for c in candidates if c not in chosen), key=separation))
    return chosen


def negative_examples(grid, blocked) -> list[dict]:
    examples = []
    for label, point in (("outside_map", Point(12.0, 0.0)),):
        examples.append({"label": label, "target": [point.x_m, point.y_m],
                         "classification": classify_point(grid, blocked, point)})
    # Первая клетка препятствия и первая клетка внутри запаса около центра арены.
    found = {"obstacle": None, "inside_clearance": None}
    for point in sorted(lattice(0.05, 1.5), key=lambda p: math.hypot(p.x_m, p.y_m)):
        kind = classify_point(grid, blocked, point)
        if kind in found and found[kind] is None:
            found[kind] = point
        if all(found.values()):
            break
    for kind, point in found.items():
        if point is not None:
            examples.append({"label": kind, "target": [round(point.x_m, 3), round(point.y_m, 3)],
                             "classification": kind})
    return examples


def render_svg(grid, blocked, base: Point, chosen: list[dict], negatives: list[dict]) -> str:
    view_half = ARENA_HALF_SIZE_M + 0.3
    pixels_per_m = 120
    size = int(2 * view_half * pixels_per_m)

    def to_svg(x_m: float, y_m: float) -> tuple[float, float]:
        return ((x_m + view_half) * pixels_per_m, (view_half - y_m) * pixels_per_m)

    cell_px = grid.resolution_m * pixels_per_m
    shapes = [f'<rect width="{size}" height="{size}" fill="#111614"/>']

    def cell_fill(column: int, row: int) -> str | None:
        center = grid.cell_center(column, row)
        if abs(center.x_m) > view_half or abs(center.y_m) > view_half:
            return None
        index = grid.index(column, row)
        value = grid.cells[index]
        if value == OBSTACLE:
            return MAP_COLORS["obstacle"]
        if value != FREE:
            return None
        return MAP_COLORS["clearance"] if index in blocked else MAP_COLORS["free"]

    # Соседние клетки одного цвета склеиваются в отрезок строки: SVG в разы меньше.
    for row in range(grid.height):
        column = 0
        while column < grid.width:
            fill = cell_fill(column, row)
            run_end = column + 1
            while run_end < grid.width and cell_fill(run_end, row) == fill:
                run_end += 1
            if fill is not None:
                corner = grid.cell_center(column, row)
                x, y = to_svg(corner.x_m - grid.resolution_m / 2, corner.y_m + grid.resolution_m / 2)
                shapes.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell_px * (run_end - column) + 0.4:.1f}" '
                              f'height="{cell_px + 0.4:.1f}" fill="{fill}"/>')
            column = run_end
    for item in chosen:
        points = [to_svg(base.x_m, base.y_m), *(to_svg(*p) for p in item["to_target"]["waypoints"])]
        polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
        shapes.append(f'<polyline points="{polyline}" fill="none" stroke="#2FBF71" stroke-width="4" '
                      f'stroke-dasharray="6 12" stroke-linecap="round" stroke-linejoin="round"/>')
    for item in chosen:
        x, y = to_svg(*item["target"])
        shapes.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="12" fill="none" stroke="#2FBF71" stroke-width="4"/>')
        shapes.append(f'<text x="{x + 16:.1f}" y="{y - 14:.1f}" fill="#F3F5F2" '
                      f'font-family="JetBrains Mono, monospace" font-size="22">{item["id"]}</text>')
    for item in negatives:
        if item["label"] == "outside_map":
            continue
        x, y = to_svg(*item["target"])
        shapes.append(f'<path d="M{x - 10:.1f} {y - 10:.1f}l20 20m0 -20l-20 20" stroke="#F28B82" stroke-width="4"/>')
    base_x, base_y = to_svg(base.x_m, base.y_m)
    shapes.append(f'<rect x="{base_x - 16:.1f}" y="{base_y - 16:.1f}" width="32" height="32" rx="6" fill="#F3F5F2"/>')
    shapes.append(f'<rect x="{base_x - 7:.1f}" y="{base_y - 7:.1f}" width="14" height="14" rx="3" fill="#111614"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
            f'width="{size}" height="{size}">' + "".join(shapes) + "</svg>")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--map", default=str(REPOSITORY_ROOT / "simulation/judge/data/map.yaml"))
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--out-dir", default=str(REPOSITORY_ROOT / "artifacts/defense"))
    arguments = parser.parse_args()

    settings = MissionSettings()
    map_path = Path(arguments.map)
    grid = load_nav2_map(map_path)
    blocked = grid.inflated_blocked(settings.clearance_m)
    base = settings.base

    candidates = []
    for point in lattice(LATTICE_STEP_M, ARENA_HALF_SIZE_M):
        if classify_point(grid, blocked, point) != "free" or not has_click_margin(grid, blocked, point) \
                or not far_from_obstacles(grid, point):
            continue
        outbound = route(grid, blocked, base, point)
        if outbound is None or not MIN_PATH_M <= outbound["length_m"] <= MAX_PATH_M:
            continue
        inbound = route(grid, blocked, point, base)
        if inbound is None:
            continue
        estimate = (travel_estimate_s(outbound["length_m"], len(outbound["waypoints"]), settings.max_linear_mps)
                    + travel_estimate_s(inbound["length_m"], len(inbound["waypoints"]), settings.max_linear_mps))
        candidates.append({"target": [round(point.x_m, 3), round(point.y_m, 3)],
                           "to_target": outbound, "to_base": inbound,
                           "estimated_round_trip_s": round(estimate, 1)})

    chosen = pick_spread(candidates, arguments.count)
    for number, item in enumerate(chosen, start=1):
        item["id"] = f"T{number}"
    negatives = negative_examples(grid, blocked)

    out_dir = Path(arguments.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "offline A* on public map; hidden samples not read",
        "map_id": grid.map_id,
        "map_yaml": str(map_path.relative_to(REPOSITORY_ROOT)),
        "map_pgm_sha256": hashlib.sha256((map_path.parent / "map.pgm").read_bytes()).hexdigest(),
        "base": [base.x_m, base.y_m],
        "clearance_m": settings.clearance_m,
        "max_linear_mps": settings.max_linear_mps,
        "arrival_tolerance_m": settings.arrival_tolerance_m,
        "target_margin_m": TARGET_MARGIN_M,
        "min_obstacle_distance_m": MIN_OBSTACLE_DISTANCE_M,
        "candidate_count": len(candidates),
        "targets": chosen,
        "negative_examples": negatives,
    }
    (out_dir / "targets.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    (out_dir / "targets-map.svg").write_text(render_svg(grid, blocked, base, chosen, negatives))
    for item in chosen:
        print(f'{item["id"]} target={item["target"]} out={item["to_target"]["length_m"]} m '
              f'back={item["to_base"]["length_m"]} m round_trip≈{item["estimated_round_trip_s"]} s')
    for item in negatives:
        print(f'negative {item["label"]}: {item["target"]} -> {item["classification"]}')
    print(f"map_id={grid.map_id} candidates={len(candidates)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
