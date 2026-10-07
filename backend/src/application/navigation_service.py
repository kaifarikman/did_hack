"""Маршруты и энергия возврата поверх карты, запаса и оценки стоимости грунта.

Карта берётся из источника при каждом обращении: статичная не меняется, карта SLAM растёт и
уточняется (`revision`). Пока карты нет, маршрутов нет. Неизвестные клетки непроходимы, поэтому
разведка идёт к границе изученного (frontier), а не сквозь неизвестность.
"""
from __future__ import annotations

from dataclasses import dataclass

from application.ports import MapSource
from domain.energy import TerrainEstimator
from domain.geometry import Point, distance_m
from domain.grid import UNKNOWN, OccupancyGrid
from domain.hazards import HazardMap
from domain.pathfinding import find_path, path_length_m, reachable_cells
from domain.settings import MissionSettings


@dataclass(frozen=True)
class Route:
    waypoints: tuple[Point, ...]
    length_m: float
    energy: float  # консервативная оценка с учётом неопределённости


class FixedMap:
    """Источник неизменной карты (готовая карта turtlebot3_world, тесты)."""

    def __init__(self, grid: OccupancyGrid | None) -> None:
        self._grid = grid

    def load(self) -> OccupancyGrid | None:
        return self._grid


class NavigationService:
    def __init__(self, maps: MapSource | OccupancyGrid, estimator: TerrainEstimator, settings: MissionSettings,
                 hazards: HazardMap | None = None) -> None:
        self._maps = maps if hasattr(maps, "load") else FixedMap(maps)
        self._estimator = estimator
        self._settings = settings
        self._hazards = hazards or HazardMap()
        self._grid: OccupancyGrid | None = None
        self._key: tuple[str, int] | None = None
        self._blocked: frozenset[int] = frozenset()

    def _current(self) -> OccupancyGrid | None:
        grid = self._maps.load()
        if grid is None:
            return None
        key = (grid.map_id, grid.revision)
        if key != self._key:  # новая версия карты: запретные клетки пересчитываются
            self._grid, self._key = grid, key
            self._blocked = grid.inflated_blocked(self._settings.clearance_m)
        return self._grid

    @property
    def map_available(self) -> bool:
        return self._current() is not None

    @property
    def map_id(self) -> str | None:
        grid = self._current()
        return None if grid is None else grid.versioned_id

    @property
    def map_revision(self) -> int:
        grid = self._current()
        return -1 if grid is None else grid.revision

    def _terrain_multiplier(self, point: Point) -> float:
        """Маршрут предпочитает дешёвые участки и обходит наблюдаемые опасности."""
        terrain = self._estimator.estimate_at(point).energy_per_m / self._settings.nominal_energy_per_m
        return terrain * self._hazards.cost_multiplier(point)

    def route(self, start: Point, goal: Point) -> Route | None:
        grid = self._current()
        if grid is None:
            return None
        waypoints = find_path(grid, self._blocked, start, goal, self._terrain_multiplier)
        if waypoints is None:
            return None
        penalty = self._hazards.expected_penalty * self._hazards.crossings(start, waypoints)
        return Route(
            tuple(waypoints),
            path_length_m(start, waypoints),
            self._estimator.path_energy(start, waypoints, self._settings.return_safety_factor) + penalty,
        )

    def return_energy(self, start: Point) -> float | None:
        """Оценка возврата на базу; None — база недостижима (неизвестность, не бесплатный возврат)."""
        route = self.route(start, self._settings.base)
        return route.energy if route else None

    def is_reachable(self, goal: Point) -> bool:
        grid = self._current()
        if grid is None:
            return False
        cell = grid.world_to_cell(goal)
        return cell is not None and grid.index(*cell) not in self._blocked

    def path_blocked(self, start: Point, path: tuple[Point, ...] | list[Point]) -> bool:
        """Ломаная от `start` через `path` задевает клетку, ставшую запретной на текущей карте."""
        grid = self._current()
        if grid is None:
            return bool(path)
        step = grid.resolution_m / 2
        previous = start
        for waypoint in path:
            pieces = max(1, int(distance_m(previous, waypoint) / step))
            for piece in range(1, pieces + 1):
                fraction = piece / pieces
                probe = Point(previous.x_m + (waypoint.x_m - previous.x_m) * fraction,
                              previous.y_m + (waypoint.y_m - previous.y_m) * fraction)
                if distance_m(probe, start) < self._settings.clearance_m:
                    continue  # робот может стоять в запасе у стены: начало пути не считается помехой
                cell = grid.world_to_cell(probe)
                if cell is None or grid.index(*cell) in self._blocked:
                    return True
            previous = waypoint
        return False

    def lattice_points(self, start: Point) -> list[Point]:
        """Достижимые точки решётки — кандидаты для поиска."""
        grid = self._current()
        if grid is None:
            return []
        reachable = reachable_cells(grid, self._blocked, start)
        stride = max(1, round(self._settings.candidate_lattice_step_m / grid.resolution_m))
        return [
            grid.cell_center(column, row)
            for column, row in reachable
            if column % stride == 0 and row % stride == 0
            and distance_m(grid.cell_center(column, row), start)
            <= self._settings.candidate_max_distance_m
        ]

    def frontier_points(self, start: Point, reach_cells: int | None = None) -> list[Point]:
        """Достижимые безопасные клетки у границы с неизвестным, по одной на квадрат решётки."""
        grid = self._current()
        if grid is None:
            return []
        reach = reach_cells if reach_cells is not None else round(self._settings.clearance_m / grid.resolution_m) + 2
        stride = max(1, round(self._settings.candidate_lattice_step_m / grid.resolution_m))
        chosen: dict[tuple[int, int], Point] = {}
        for column, row in reachable_cells(grid, self._blocked, start):
            square = (column // stride, row // stride)
            if square in chosen:
                continue
            near_unknown = any(
                grid.contains(column + d_col, row + d_row)
                and grid.cells[grid.index(column + d_col, row + d_row)] == UNKNOWN
                for d_col in (-reach, 0, reach) for d_row in (-reach, 0, reach)
            )
            if near_unknown:
                point = grid.cell_center(column, row)
                if distance_m(point, start) <= self._settings.candidate_max_distance_m:
                    chosen[square] = point
        return list(chosen.values())
