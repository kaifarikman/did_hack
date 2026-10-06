"""Поиск маршрута A* по сетке с запасом и стоимостью клеток, упрощение до путевых точек."""
from __future__ import annotations

import heapq
import math
from collections import deque
from typing import Callable

from domain.geometry import Point, distance_m
from domain.grid import OccupancyGrid

CostMultiplier = Callable[[Point], float]
_NEIGHBORS = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]


def _nearest_free_cell(
    grid: OccupancyGrid, blocked: frozenset[int], column: int, row: int, max_cells: int
) -> tuple[int, int] | None:
    """Ближайшая допустимая клетка, если робот стоит внутри запретного запаса."""
    seen = {(column, row)}
    queue = deque([(column, row, 0)])
    while queue:
        col, current_row, steps = queue.popleft()
        if grid.contains(col, current_row) and grid.index(col, current_row) not in blocked:
            return col, current_row
        if steps >= max_cells:
            continue
        for d_col, d_row in _NEIGHBORS:
            neighbor = (col + d_col, current_row + d_row)
            if neighbor not in seen and grid.contains(*neighbor):
                seen.add(neighbor)
                queue.append((*neighbor, steps + 1))
    return None


def _line_cost(
    grid: OccupancyGrid,
    blocked: frozenset[int],
    first: tuple[int, int],
    second: tuple[int, int],
    multiplier,
) -> float | None:
    """Стоимость прямой между клетками или None, если линия пересекает запретные клетки."""
    steps = max(abs(second[0] - first[0]), abs(second[1] - first[1]), 1)
    length = math.hypot(second[0] - first[0], second[1] - first[1])
    total = 0.0
    for step in range(steps + 1):
        column = round(first[0] + (second[0] - first[0]) * step / steps)
        row = round(first[1] + (second[1] - first[1]) * step / steps)
        if grid.index(column, row) in blocked:
            return None
        total += multiplier(column, row)
    return total * length / (steps + 1)


def find_path(
    grid: OccupancyGrid,
    blocked: frozenset[int],
    start: Point,
    goal: Point,
    cost_multiplier: CostMultiplier | None = None,
    start_snap_cells: int = 8,
) -> list[Point] | None:
    """Путевые точки от старта (не включён) до цели; None, если цель недостижима."""
    start_cell = grid.world_to_cell(start)
    goal_cell = grid.world_to_cell(goal)
    if start_cell is None or goal_cell is None:
        return None
    if grid.index(*goal_cell) in blocked:
        return None
    if grid.index(*start_cell) in blocked:
        start_cell = _nearest_free_cell(grid, blocked, *start_cell, start_snap_cells)
        if start_cell is None:
            return None

    multiplier_cache: dict[int, float] = {}

    def multiplier(column: int, row: int) -> float:
        cell_index = grid.index(column, row)
        if cell_index not in multiplier_cache:
            value = cost_multiplier(grid.cell_center(column, row)) if cost_multiplier else 1.0
            multiplier_cache[cell_index] = max(1.0, value)
        return multiplier_cache[cell_index]

    def heuristic(column: int, row: int) -> float:
        return math.hypot(goal_cell[0] - column, goal_cell[1] - row)

    best_cost = {start_cell: 0.0}
    parents: dict[tuple[int, int], tuple[int, int]] = {}
    frontier = [(heuristic(*start_cell), 0.0, start_cell)]
    found = False
    while frontier:
        _, cost, cell = heapq.heappop(frontier)
        if cell == goal_cell:
            found = True
            break
        if cost > best_cost.get(cell, math.inf):
            continue
        for d_col, d_row in _NEIGHBORS:
            column, row = cell[0] + d_col, cell[1] + d_row
            if not grid.contains(column, row) or grid.index(column, row) in blocked:
                continue
            if d_col and d_row and (
                grid.index(cell[0] + d_col, cell[1]) in blocked
                or grid.index(cell[0], cell[1] + d_row) in blocked
            ):
                continue  # без срезания углов
            step = math.hypot(d_col, d_row) * multiplier(column, row)
            new_cost = cost + step
            if new_cost < best_cost.get((column, row), math.inf):
                best_cost[(column, row)] = new_cost
                parents[(column, row)] = cell
                heapq.heappush(frontier, (new_cost + heuristic(column, row), new_cost, (column, row)))
    if not found:
        return None

    cells = [goal_cell]
    while cells[-1] != start_cell:
        cells.append(parents[cells[-1]])
    cells.reverse()

    def segment_cost(first_index: int, second_index: int) -> float:
        return best_cost[cells[second_index]] - best_cost[cells[first_index]]

    kept = [cells[0]]
    anchor = 0
    for index in range(2, len(cells)):
        straight = _line_cost(grid, blocked, cells[anchor], cells[index], multiplier)
        # упрощаем, только если прямая допустима и не дороже исходного пути (учёт грунта)
        if straight is None or straight > segment_cost(anchor, index) * 1.05 + 1e-9:
            anchor = index - 1
            kept.append(cells[anchor])
    if cells[-1] != kept[-1]:
        kept.append(cells[-1])
    waypoints = [grid.cell_center(*cell) for cell in kept[1:]]
    if waypoints:
        waypoints[-1] = goal
    else:
        waypoints = [goal]
    return waypoints


def path_length_m(start: Point, waypoints: list[Point]) -> float:
    total, previous = 0.0, start
    for waypoint in waypoints:
        total += distance_m(previous, waypoint)
        previous = waypoint
    return total


def reachable_cells(
    grid: OccupancyGrid, blocked: frozenset[int], start: Point, start_snap_cells: int = 8
) -> set[tuple[int, int]]:
    """Все клетки, достижимые из стартовой по 8-связности."""
    start_cell = grid.world_to_cell(start)
    if start_cell is None:
        return set()
    if grid.index(*start_cell) in blocked:
        start_cell = _nearest_free_cell(grid, blocked, *start_cell, start_snap_cells)
        if start_cell is None:
            return set()
    seen = {start_cell}
    queue = deque([start_cell])
    while queue:
        column, row = queue.popleft()
        for d_col, d_row in _NEIGHBORS:
            neighbor = (column + d_col, row + d_row)
            if neighbor in seen or not grid.contains(*neighbor):
                continue
            if grid.index(*neighbor) in blocked:
                continue
            seen.add(neighbor)
            queue.append(neighbor)
    return seen
