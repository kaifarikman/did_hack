"""Маршруты и энергия возврата поверх карты, запаса и оценки стоимости грунта."""
from __future__ import annotations

from dataclasses import dataclass

from domain.energy import TerrainEstimator
from domain.geometry import Point, distance_m
from domain.grid import OccupancyGrid
from domain.pathfinding import find_path, path_length_m, reachable_cells
from domain.settings import MissionSettings


@dataclass(frozen=True)
class Route:
    waypoints: tuple[Point, ...]
    length_m: float
    energy: float  # консервативная оценка с учётом неопределённости


class NavigationService:
    def __init__(self, grid: OccupancyGrid, estimator: TerrainEstimator, settings: MissionSettings) -> None:
        self._grid = grid
        self._estimator = estimator
        self._settings = settings
        self._blocked = grid.inflated_blocked(settings.clearance_m)

    def _terrain_multiplier(self, point: Point) -> float:
        """Маршрут предпочитает дешёвые участки: стоимость относительно номинальной."""
        return self._estimator.estimate_at(point).energy_per_m / self._settings.nominal_energy_per_m

    def route(self, start: Point, goal: Point) -> Route | None:
        waypoints = find_path(self._grid, self._blocked, start, goal, self._terrain_multiplier)
        if waypoints is None:
            return None
        return Route(
            tuple(waypoints),
            path_length_m(start, waypoints),
            self._estimator.path_energy(start, waypoints, self._settings.return_safety_factor),
        )

    def return_energy(self, start: Point) -> float | None:
        """Оценка возврата на базу; None — база недостижима (неизвестность, не бесплатный возврат)."""
        route = self.route(start, self._settings.base)
        return route.energy if route else None

    def is_reachable(self, goal: Point) -> bool:
        cell = self._grid.world_to_cell(goal)
        return cell is not None and self._grid.index(*cell) not in self._blocked

    def lattice_points(self, start: Point) -> list[Point]:
        """Достижимые точки решётки — кандидаты для поиска."""
        reachable = reachable_cells(self._grid, self._blocked, start)
        stride = max(1, round(self._settings.candidate_lattice_step_m / self._grid.resolution_m))
        return [
            self._grid.cell_center(column, row)
            for column, row in reachable
            if column % stride == 0 and row % stride == 0
            and distance_m(self._grid.cell_center(column, row), start)
            <= self._settings.candidate_max_distance_m
        ]
