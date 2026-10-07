"""Карта SLAM Toolbox → нормализованная сетка контракта в мировых координатах.

Кадр `map` начинается в точке старта робота, оси совпадают с мировыми (старт без поворота),
поэтому мировой origin = base_world + origin карты. Готовая карта мира здесь не участвует.
"""
from __future__ import annotations

import hashlib
import threading
from typing import Sequence

from domain.geometry import Pose
from domain.grid import FREE, OBSTACLE, UNKNOWN, OccupancyGrid

OCCUPIED_THRESHOLD = 65  # значения nav_msgs/OccupancyGrid: -1 неизвестно, 0..100 вероятность занятости


def grid_from_slam(
    revision: int,
    resolution_m: float,
    width: int,
    height: int,
    origin_x_m: float,
    origin_y_m: float,
    origin_heading_rad: float,
    data: Sequence[int],
    base_world_m: tuple[float, float],
) -> OccupancyGrid:
    cells = [UNKNOWN if value < 0 else OBSTACLE if value >= OCCUPIED_THRESHOLD else FREE for value in data]
    digest = hashlib.sha1(bytes(value & 0xFF for value in data)).hexdigest()[:8]
    origin = Pose(base_world_m[0] + origin_x_m, base_world_m[1] + origin_y_m, origin_heading_rad)
    return OccupancyGrid(f"slam-r{revision}-{digest}", resolution_m, width, height, origin, cells)


class RosSlamMapSource:
    """MapSource поверх подписки на /map: None, пока SLAM не опубликовал первую карту."""

    def __init__(self, node, base_world_m: tuple[float, float]) -> None:
        from nav_msgs.msg import OccupancyGrid as RosOccupancyGrid
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

        self._base_world_m = base_world_m
        self._lock = threading.Lock()
        self._grid: OccupancyGrid | None = None
        self._revision = 0
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        node.create_subscription(RosOccupancyGrid, "/map", self._on_map, latched)

    def _on_map(self, message) -> None:
        info = message.info
        orientation = info.origin.orientation
        import math
        heading = math.atan2(2.0 * (orientation.w * orientation.z + orientation.x * orientation.y),
                             1.0 - 2.0 * (orientation.y ** 2 + orientation.z ** 2))
        with self._lock:
            self._revision += 1
            self._grid = grid_from_slam(
                self._revision, info.resolution, info.width, info.height,
                info.origin.position.x, info.origin.position.y, heading, message.data, self._base_world_m)

    def load(self) -> OccupancyGrid | None:
        with self._lock:
            return self._grid

    def forget(self) -> None:
        """Новый прогон начинает с пустой карты: SLAM перезапускается при reset."""
        with self._lock:
            self._grid, self._revision = None, 0
