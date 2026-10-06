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
        """Индексы клеток, где центр робота недопустим: препятствия, неизвестное и запас."""
        radius_cells = math.ceil(clearance_m / self.resolution_m)
        offsets = [
            (d_col, d_row)
            for d_col in range(-radius_cells, radius_cells + 1)
            for d_row in range(-radius_cells, radius_cells + 1)
            if math.hypot(d_col, d_row) * self.resolution_m <= clearance_m + 1e-9
        ]
        blocked: set[int] = set()
        for row in range(self.height):
            for column in range(self.width):
                if self.cells[self.index(column, row)] == FREE:
                    continue
                for d_col, d_row in offsets:
                    if self.contains(column + d_col, row + d_row):
                        blocked.add(self.index(column + d_col, row + d_row))
        return frozenset(blocked)
