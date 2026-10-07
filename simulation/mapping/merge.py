"""Слияние карт SLAM нескольких роботов в одну карту мировой системы координат. Без ROS.

Каждая карта строится в кадре своего робота: начало кадра — точка старта, оси совпадают с мировыми
(роботы стартуют без относительного поворота). Мировая позиция = старт робота + позиция в его карте.
Правило слияния клетки (консервативное): занято у любого — занято; иначе свободно у любого — свободно;
иначе неизвестно. Это локальное допущение проекта.
"""
from dataclasses import dataclass
from typing import List, Sequence, Tuple

UNKNOWN = -1
FREE = 0
OCCUPIED = 100
OCCUPIED_THRESHOLD = 65


@dataclass(frozen=True)
class RobotMap:
    resolution_m: float
    width: int
    height: int
    origin_x_m: float  # origin карты в кадре робота
    origin_y_m: float
    data: Sequence[int]  # row-major, значения nav_msgs/OccupancyGrid
    start_world_m: Tuple[float, float]  # старт робота в мире


@dataclass(frozen=True)
class MergedMap:
    resolution_m: float
    width: int
    height: int
    origin_x_m: float  # мировые координаты
    origin_y_m: float
    data: List[int]


def merge_maps(maps: Sequence[RobotMap]) -> MergedMap:
    if not maps:
        raise ValueError("Нет карт для слияния")
    resolution = maps[0].resolution_m
    if any(abs(item.resolution_m - resolution) > 1e-9 for item in maps):
        raise ValueError("Карты с разным разрешением не сливаются")
    # Индексы клеток считаются на общей решётке, привязанной к мировому нулю
    offsets = [(round((item.start_world_m[0] + item.origin_x_m) / resolution),
                round((item.start_world_m[1] + item.origin_y_m) / resolution)) for item in maps]
    min_column = min(column for column, _ in offsets)
    min_row = min(row for _, row in offsets)
    max_column = max(column + item.width for (column, _), item in zip(offsets, maps))
    max_row = max(row + item.height for (_, row), item in zip(offsets, maps))
    width, height = max_column - min_column, max_row - min_row
    merged = [UNKNOWN] * (width * height)
    for (column_offset, row_offset), item in zip(offsets, maps):
        for row in range(item.height):
            target_start = (row_offset - min_row + row) * width + (column_offset - min_column)
            source_start = row * item.width
            for column in range(item.width):
                merged[target_start + column] = _merge_cell(merged[target_start + column],
                                                            item.data[source_start + column])
    return MergedMap(resolution, width, height, min_column * resolution, min_row * resolution, merged)


def _merge_cell(current: int, incoming: int) -> int:
    if incoming < 0:
        return current
    incoming_class = OCCUPIED if incoming >= OCCUPIED_THRESHOLD else FREE
    if current == OCCUPIED or incoming_class == OCCUPIED:
        return OCCUPIED
    return FREE
