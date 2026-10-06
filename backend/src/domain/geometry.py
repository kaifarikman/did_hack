"""Геометрические значения: точка и поза в мировой системе Gazebo (метры, радианы)."""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    x_m: float
    y_m: float


@dataclass(frozen=True)
class Pose:
    x_m: float
    y_m: float
    heading_rad: float

    @property
    def point(self) -> Point:
        return Point(self.x_m, self.y_m)


def distance_m(first: Point, second: Point) -> float:
    return math.hypot(first.x_m - second.x_m, first.y_m - second.y_m)


def normalize_angle(angle_rad: float) -> float:
    return math.atan2(math.sin(angle_rad), math.cos(angle_rad))
