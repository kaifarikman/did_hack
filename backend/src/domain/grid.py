"""Карта-сетка: преобразование координат и запретный запас вокруг препятствий."""
from __future__ import annotations

import math
from typing import Sequence

from domain.geometry import Point, Pose

FREE = 0
OBSTACLE = 100
UNKNOWN = -1


class OccupancyGrid:
    """Нормализованная карта контракта: row-major, `cells[row * width + column]`."""

    def __init__(
        self,
        map_id: str,
        resolution_m: float,
        width: int,
        height: int,
        origin: Pose,
        cells: Sequence[int],
        revision: int = 0,
        frame_id: str = "world",
    ) -> None:
        if resolution_m <= 0 or width <= 0 or height <= 0:
            raise ValueError("размеры и разрешение карты должны быть положительными")
        if len(cells) != width * height:
            raise ValueError("длина cells должна быть width * height")
        self.map_id = map_id
        self.resolution_m = resolution_m
        self.width = width
        self.height = height
        self.origin = origin
        self.cells = tuple(cells)
        self.revision = revision  # растёт при каждом изменении карты (SLAM); статичная карта — 0
        self.frame_id = frame_id  # система координат клеток; агент работает только в world

    @property
    def versioned_id(self) -> str:
        """Идентификатор конкретной версии: панель перезагружает карту при его смене (SLAM)."""
        return self.map_id if self.revision == 0 else f"{self.map_id}#r{self.revision}"

    def index(self, column: int, row: int) -> int:
        return row * self.width + column

    def contains(self, column: int, row: int) -> bool:
        return 0 <= column < self.width and 0 <= row < self.height

    def cell_center(self, column: int, row: int) -> Point:
        local_x = (column + 0.5) * self.resolution_m
        local_y = (row + 0.5) * self.resolution_m
        cos_h, sin_h = math.cos(self.origin.heading_rad), math.sin(self.origin.heading_rad)
        return Point(
            self.origin.x_m + local_x * cos_h - local_y * sin_h,
            self.origin.y_m + local_x * sin_h + local_y * cos_h,
        )

    def world_to_cell(self, point: Point) -> tuple[int, int] | None:
        delta_x = point.x_m - self.origin.x_m
        delta_y = point.y_m - self.origin.y_m
        cos_h, sin_h = math.cos(self.origin.heading_rad), math.sin(self.origin.heading_rad)
        local_x = delta_x * cos_h + delta_y * sin_h
        local_y = -delta_x * sin_h + delta_y * cos_h
        column = math.floor(local_x / self.resolution_m)
        row = math.floor(local_y / self.resolution_m)
        return (column, row) if self.contains(column, row) else None

    def inflated_blocked(self, clearance_m: float) -> frozenset[int]:
        """Индексы клеток, где центр робота недопустим: препятствия, неизвестное и запас.

        Проход только по свободным клеткам: на строящейся карте SLAM их мало относительно размера
        карты, а безопасна лишь свободная клетка, у которой все клетки в радиусе запаса свободны.
        """
        radius_cells = math.ceil(clearance_m / self.resolution_m)
        offsets = [
            (d_col, d_row)
            for d_col in range(-radius_cells, radius_cells + 1)
            for d_row in range(-radius_cells, radius_cells + 1)
            if math.hypot(d_col, d_row) * self.resolution_m <= clearance_m + 1e-9
        ]
        cells, width, height = self.cells, self.width, self.height
        safe: set[int] = set()
        for index, value in enumerate(cells):
            if value != FREE:
                continue
            row, column = divmod(index, width)
            if all(
                not (0 <= column + d_col < width and 0 <= row + d_row < height)
                or cells[(row + d_row) * width + column + d_col] == FREE
                for d_col, d_row in offsets
            ):
                safe.add(index)
        return frozenset(set(range(width * height)) - safe)
