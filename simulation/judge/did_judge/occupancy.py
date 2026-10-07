"""Сетка занятости: чтение PGM/YAML карты nav2 и достижимость клеток."""
import heapq
import math
import re
from collections import deque
from dataclasses import dataclass
from typing import List, Tuple

Cell = Tuple[int, int]


@dataclass(frozen=True)
class OccupancyGrid:
    resolution_m: float
    origin_x_m: float
    origin_y_m: float
    width: int
    height: int
    free: Tuple[bool, ...]  # row-major, строка 0 — нижняя (по возрастанию Y)

    def index(self, column: int, row: int) -> int:
        return row * self.width + column

    def is_free(self, column: int, row: int) -> bool:
        return (0 <= column < self.width and 0 <= row < self.height
                and self.free[self.index(column, row)])

    def cell_of(self, x_m: float, y_m: float) -> Cell:
        return (math.floor((x_m - self.origin_x_m) / self.resolution_m),
                math.floor((y_m - self.origin_y_m) / self.resolution_m))

    def center_of(self, column: int, row: int) -> Tuple[float, float]:
        return (self.origin_x_m + (column + 0.5) * self.resolution_m,
                self.origin_y_m + (row + 0.5) * self.resolution_m)

    def inflated(self, radius_m: float) -> "OccupancyGrid":
        """Свободны только клетки, вокруг которых на radius_m нет несвободных."""
        reach = math.ceil(radius_m / self.resolution_m)
        offsets = [(dc, dr) for dc in range(-reach, reach + 1) for dr in range(-reach, reach + 1)
                   if math.hypot(dc, dr) * self.resolution_m <= radius_m]
        safe: List[bool] = []
        for row in range(self.height):
            for column in range(self.width):
                safe.append(self.is_free(column, row) and all(
                    self.is_free(column + dc, row + dr) for dc, dr in offsets))
        return OccupancyGrid(self.resolution_m, self.origin_x_m, self.origin_y_m,
                             self.width, self.height, tuple(safe))

    def reachable_from(self, start: Cell) -> List[Cell]:
        """Клетки, достижимые от start по 8-связности внутри свободных клеток."""
        if not self.is_free(*start):
            return []
        seen = {start}
        queue = deque([start])
        while queue:
            column, row = queue.popleft()
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    neighbour = (column + dc, row + dr)
                    if neighbour not in seen and self.is_free(*neighbour):
                        if dc and dr and not (self.is_free(column + dc, row)
                                              and self.is_free(column, row + dr)):
                            continue
                        seen.add(neighbour)
                        queue.append(neighbour)
        return sorted(seen)


    def path_lengths_from(self, start: Cell) -> dict:
        """Длины кратчайших путей (м) от start до достижимых клеток; шаги 8-связные."""
        if not self.is_free(*start):
            return {}
        lengths = {start: 0.0}
        queue = [(0.0, start)]
        while queue:
            length, cell = heapq.heappop(queue)
            if length > lengths[cell]:
                continue
            column, row = cell
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    neighbour = (column + dc, row + dr)
                    if (dc or dr) and self.is_free(*neighbour):
                        if dc and dr and not (self.is_free(column + dc, row)
                                              and self.is_free(column, row + dr)):
                            continue
                        candidate = length + math.hypot(dc, dr) * self.resolution_m
                        if candidate < lengths.get(neighbour, math.inf):
                            lengths[neighbour] = candidate
                            heapq.heappush(queue, (candidate, neighbour))
        return lengths


def _read_pgm(path: str) -> Tuple[int, int, List[int]]:
    with open(path, "rb") as stream:
        content = stream.read()
    header_match = re.match(rb"P5\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s", content)
    if header_match is None:
        raise ValueError("Ожидается бинарный PGM (P5)")
    width, height, _max_value = (int(group) for group in header_match.groups())
    pixels = list(content[header_match.end():header_match.end() + width * height])
    if len(pixels) != width * height:
        raise ValueError("PGM обрезан")
    return width, height, pixels


def _read_yaml_values(path: str) -> dict:
    values = {}
    with open(path, encoding="utf-8") as stream:
        for line in stream:
            key, _, value = line.partition(":")
            values[key.strip()] = value.strip()
    return values


def load_occupancy_grid(yaml_path: str) -> OccupancyGrid:
    """Читает карту nav2 (trinary): светлее free_thresh — свободно, остальное блокирует."""
    import os
    meta = _read_yaml_values(yaml_path)
    resolution = float(meta["resolution"])
    origin = [float(part) for part in meta["origin"].strip("[]").split(",")]
    negate = int(meta.get("negate", "0"))
    free_threshold = float(meta["free_thresh"])
    width, height, pixels = _read_pgm(os.path.join(os.path.dirname(yaml_path), meta["image"]))
    free = [False] * (width * height)
    for image_row in range(height):
        row = height - 1 - image_row  # PGM идёт сверху вниз
        for column in range(width):
            value = pixels[image_row * width + column]
            occupancy = value / 255.0 if negate else (255 - value) / 255.0
            free[row * width + column] = occupancy < free_threshold
    return OccupancyGrid(resolution, origin[0], origin[1], width, height, tuple(free))
