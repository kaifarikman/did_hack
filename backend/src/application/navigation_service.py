"""Маршруты и энергия возврата поверх карты, запаса и оценки стоимости грунта.

Карта берётся из источника при каждом обращении: статичная не меняется, карта SLAM растёт и
уточняется (`revision`). Пока карты нет, маршрутов нет. Неизвестные клетки непроходимы, поэтому
разведка идёт к границе изученного (frontier), а не сквозь неизвестность.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from application.ports import MapSource
from domain.energy import TerrainEstimator
from domain.geometry import Point, distance_m
from domain.grid import FREE, OBSTACLE, UNKNOWN, OccupancyGrid
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
        self._dynamic_key: tuple[str, int] | None = None
        self._dynamic_expiry: dict[int, float] = {}
        self._dynamic_points: dict[int, tuple[Point, float]] = {}
        self._dynamic_candidates: dict[int, tuple[int, float]] = {}
        self._latest_scan_points: tuple[Point, ...] = ()
        self._dynamic_blocked: frozenset[int] = frozenset()
        self._dynamic_revision = 0
        self._static_distance_m: list[float] | None = None

    def _current(self) -> OccupancyGrid | None:
        grid = self._maps.load()
        if grid is None:
            return None
        key = (grid.map_id, grid.revision)
        if key != self._key:  # новая версия карты: запретные клетки пересчитываются
            self._grid, self._key = grid, key
            # растр: поверхность препятствия на полклетки ближе центра, сглаженный отрезок проходит по
            # краю клетки; без запаса маршрут касался коридора торможения у столбов
            self._blocked = grid.inflated_blocked(self._settings.clearance_m + self._settings.planning_raster_margin_m)
            self._static_distance_m = None
            if self._dynamic_expiry:
                self._dynamic_revision += 1
            self._dynamic_key = key
            self._dynamic_expiry.clear()
            self._dynamic_points.clear()
            self._dynamic_candidates.clear()
            self._latest_scan_points = ()
            self._dynamic_blocked = frozenset()
        return self._grid

    @property
    def dynamic_obstacle_revision(self) -> int:
        return self._dynamic_revision

    def observe_dynamic_obstacles(self, points: tuple[Point, ...], now_s: float,
                                  origin: Point | None = None) -> bool:
        """Обновляет краткоживущий overlay по world-точкам свежего scan.

        Возвращает True только при изменении набора запретных клеток. Исчезнувшее
        попадание остаётся закрытым до TTL, а смена SLAM/static map очищает overlay.
        Попадание дальше `dynamic_obstacle_max_range_m` от `origin` или объяснимое известным
        препятствием карты с учётом ошибки проекции (растёт с дальностью) в overlay не входит:
        торможение по-прежнему видит все точки свежего scan.
        """
        grid = self._current()
        if grid is None:
            return False
        self._latest_scan_points = points
        points = tuple(point for point in points if not self._explained_by_map(grid, point, origin))
        old_blocked = self._dynamic_blocked
        expired = [cell for cell, expiry in self._dynamic_expiry.items() if expiry <= now_s]
        for cell in expired:
            self._dynamic_expiry.pop(cell, None)
            self._dynamic_points.pop(cell, None)
        self._dynamic_candidates = {
            cell: candidate for cell, candidate in self._dynamic_candidates.items()
            if now_s - candidate[1] <= self._settings.dynamic_obstacle_confirmation_window_s
        }
        previous_candidates = self._dynamic_candidates
        next_candidates = dict(previous_candidates)
        observed_cells: dict[int, Point] = {}
        cell_stride = max(1, round(self._settings.dynamic_obstacle_cell_m / grid.resolution_m))
        for point in points:
            cell = grid.world_to_cell(point)
            if cell is None:
                continue
            column, row = cell
            coarse_column = (column // cell_stride) * cell_stride
            coarse_row = (row // cell_stride) * cell_stride
            for candidate_row in range(coarse_row, min(grid.height, coarse_row + cell_stride)):
                for candidate_column in range(coarse_column, min(grid.width, coarse_column + cell_stride)):
                    index = grid.index(candidate_column, candidate_row)
                    if index not in self._blocked:
                        observed_cells[index] = point
        confirmations = max(1, self._settings.dynamic_obstacle_confirmations)
        expiry = now_s + self._settings.dynamic_obstacle_ttl_s
        for index, point in observed_cells.items():
            row, column = divmod(index, grid.width)
            neighbours = [index]
            for delta_row in (-1, 0, 1):
                for delta_column in (-1, 0, 1):
                    candidate_row, candidate_column = row + delta_row, column + delta_column
                    if grid.contains(candidate_column, candidate_row):
                        neighbours.append(grid.index(candidate_column, candidate_row))
            previous = max(
                (previous_candidates[cell] for cell in neighbours if cell in previous_candidates),
                key=lambda value: value[1], default=None,
            )
            count = previous[0] + 1 if previous is not None else 1
            next_candidates[index] = (count, now_s)
            if count >= confirmations:
                self._dynamic_expiry[index] = expiry
                self._dynamic_points[index] = (point, expiry)
        self._dynamic_candidates = next_candidates
        self._dynamic_blocked = self._inflate_dynamic_cells(grid)
        changed = old_blocked != self._dynamic_blocked
        if changed:
            self._dynamic_revision += 1
        return changed

    def _explained_by_map(self, grid: OccupancyGrid, point: Point, origin: Point | None) -> bool:
        cell = grid.world_to_cell(point)
        if cell is None:
            return False
        settings = self._settings
        range_m = 0.0 if origin is None else distance_m(origin, point)
        if range_m > settings.dynamic_obstacle_max_range_m:
            return True  # дальняя точка: ошибка проекции больше допуска, план уточнится при сближении
        tolerance = min(settings.static_hit_match_max_m,
                        settings.static_hit_match_m + range_m * settings.scan_heading_uncertainty_rad)
        return self._static_distances(grid)[grid.index(*cell)] <= tolerance

    def _static_distances(self, grid: OccupancyGrid) -> list[float]:
        """Расстояние от клетки до ближайшего занятого препятствия карты (дальше лимита — inf)."""
        if self._static_distance_m is not None:
            return self._static_distance_m
        limit_m = self._settings.static_hit_match_max_m
        radius = math.ceil(limit_m / grid.resolution_m)
        offsets = [
            (d_col, d_row, math.hypot(d_col, d_row) * grid.resolution_m)
            for d_col in range(-radius, radius + 1) for d_row in range(-radius, radius + 1)
            if math.hypot(d_col, d_row) * grid.resolution_m <= limit_m + 1e-9
        ]
        distances = [math.inf] * (grid.width * grid.height)
        for index, value in enumerate(grid.cells):
            if value != OBSTACLE:
                continue
            row, column = divmod(index, grid.width)
            for d_col, d_row, offset_m in offsets:
                candidate_column, candidate_row = column + d_col, row + d_row
                if grid.contains(candidate_column, candidate_row):
                    candidate = grid.index(candidate_column, candidate_row)
                    if offset_m < distances[candidate]:
                        distances[candidate] = offset_m
        self._static_distance_m = distances
        return distances

    def _inflate_dynamic_cells(self, grid: OccupancyGrid) -> frozenset[int]:
        radius_m = self._settings.clearance_m
        radius_cells = math.ceil(radius_m / grid.resolution_m)
        blocked: set[int] = set()
        for index in self._dynamic_expiry:
            row, column = divmod(index, grid.width)
            for delta_column in range(-radius_cells, radius_cells + 1):
                for delta_row in range(-radius_cells, radius_cells + 1):
                    if math.hypot(delta_column, delta_row) * grid.resolution_m > radius_m + 1e-9:
                        continue
                    candidate_column, candidate_row = column + delta_column, row + delta_row
                    if grid.contains(candidate_column, candidate_row):
                        candidate = grid.index(candidate_column, candidate_row)
                        if candidate not in self._blocked:
                            blocked.add(candidate)
        return frozenset(blocked)

    def _effective_blocked(self) -> frozenset[int]:
        return self._blocked | self._dynamic_blocked

    def command_blocked(self, pose, linear_mps: float, angular_radps: float,
                        scan_age_s: float | None, now_s: float) -> bool:
        """True if a fresh dynamic hit intersects the command's stopping corridor."""
        clearance = self._settings.clearance_m
        speed = abs(linear_mps)
        latency = max(0.0, scan_age_s or 0.0) + self._settings.scan_reaction_s
        stopping_distance = (clearance + speed * latency
                            + speed * speed / (2 * self._settings.braking_deceleration_mps2))
        heading = pose.heading_rad + (math.pi if linear_mps < 0 else 0.0)
        cos_heading, sin_heading = math.cos(heading), math.sin(heading)
        lateral_limit = self._settings.robot_radius_m + 0.03
        # поворот на месте круглого корпуса не заметает ничего за пределами радиуса: полный запас
        # торможения здесь запрещал развернуться от стены, у которой робот законно стоит
        rotation_limit = self._settings.robot_radius_m + self._settings.rotation_margin_m
        guarded_points = list(self._dynamic_points.values())
        guarded_points.extend((point, now_s + self._settings.dynamic_obstacle_ttl_s)
                              for point in self._latest_scan_points)
        for point, expiry in guarded_points:
            if expiry <= now_s:
                continue
            delta_x, delta_y = point.x_m - pose.x_m, point.y_m - pose.y_m
            longitudinal = delta_x * cos_heading + delta_y * sin_heading
            lateral = -delta_x * sin_heading + delta_y * cos_heading
            distance = math.hypot(delta_x, delta_y)
            if speed <= 1e-6 and abs(angular_radps) > 1e-6:
                if distance <= rotation_limit:
                    return True
            elif -self._settings.robot_radius_m <= longitudinal <= stopping_distance \
                    and abs(lateral) <= lateral_limit:
                return True
        return False

    def recovery_command_blocked(self, pose, linear_mps: float, angular_radps: float,
                                 scan_age_s: float | None, now_s: float) -> bool:
        """Check both fresh scan clearance and static/known-map occupancy for recovery motion."""
        if self.command_blocked(pose, linear_mps, angular_radps, scan_age_s, now_s):
            return True
        grid = self._current()
        if grid is None:
            return True
        blocked = self._effective_blocked()
        cell = grid.world_to_cell(pose.point)
        if cell is None or grid.cells[grid.index(*cell)] != FREE or grid.index(*cell) in blocked:
            return True
        if abs(linear_mps) <= 1e-6:
            # The inflated static map models the robot's full circular footprint during rotation.
            return False
        speed = abs(linear_mps)
        latency = max(0.0, scan_age_s or 0.0) + self._settings.scan_reaction_s
        horizon = (self._settings.clearance_m + speed * latency
                   + speed * speed / (2 * self._settings.braking_deceleration_mps2))
        heading = pose.heading_rad + (math.pi if linear_mps < 0 else 0.0)
        step = max(0.02, grid.resolution_m / 2)
        sample_count = max(1, math.ceil(horizon / step))
        for sample in range(1, sample_count + 1):
            distance = min(horizon, sample * step)
            point = Point(pose.x_m + distance * math.cos(heading),
                          pose.y_m + distance * math.sin(heading))
            cell = grid.world_to_cell(point)
            if cell is None or grid.cells[grid.index(*cell)] != FREE or grid.index(*cell) in blocked:
                return True
        return False

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
        waypoints = find_path(grid, self._effective_blocked(), start, goal, self._terrain_multiplier)
        if waypoints is None:
            return None
        penalty = self._hazards.expected_penalty * self._hazards.crossings(start, waypoints)
        return Route(
            tuple(waypoints),
            path_length_m(start, waypoints),
            self._estimator.path_energy(start, waypoints, self._settings.return_safety_factor) + penalty,
        )

    def return_route(self, start: Point) -> Route | None:
        return self.route(start, self._settings.base)

    def return_energy(self, start: Point) -> float | None:
        """Оценка возврата на базу; None — база недостижима (неизвестность, не бесплатный возврат)."""
        route = self.return_route(start)
        return route.energy if route else None

    def contains(self, point: Point) -> bool:
        """Точка внутри границ текущей карты (без учёта занятости)."""
        grid = self._current()
        return grid is not None and grid.world_to_cell(point) is not None

    def is_reachable(self, goal: Point) -> bool:
        grid = self._current()
        if grid is None:
            return False
        cell = grid.world_to_cell(goal)
        return cell is not None and grid.index(*cell) not in self._effective_blocked()

    def is_statically_reachable(self, goal: Point) -> bool:
        """Допустимость по карте без краткоживущего overlay свежего scan."""
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
                if cell is None or grid.index(*cell) in self._effective_blocked():
                    return True
            previous = waypoint
        return False

    def lattice_points(self, start: Point) -> list[Point]:
        """Достижимые точки решётки — кандидаты для поиска."""
        grid = self._current()
        if grid is None:
            return []
        reachable = reachable_cells(grid, self._effective_blocked(), start)
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
        for column, row in reachable_cells(grid, self._effective_blocked(), start):
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
