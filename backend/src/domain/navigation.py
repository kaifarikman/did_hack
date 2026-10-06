"""Следование путевым точкам и обнаружение отсутствия прогресса (чистая геометрия)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from domain.geometry import Point, Pose, distance_m, normalize_angle


@dataclass(frozen=True)
class VelocityCommand:
    linear_mps: float
    angular_radps: float


class PathTracker:
    def __init__(
        self,
        waypoints: list[Point],
        tolerance_m: float = 0.12,
        max_linear_mps: float = 0.15,
        max_angular_radps: float = 1.0,
        turn_in_place_rad: float = 0.5,
    ) -> None:
        self._waypoints = list(waypoints)
        self._tolerance = tolerance_m
        self._max_linear = max_linear_mps
        self._max_angular = max_angular_radps
        self._turn_in_place = turn_in_place_rad
        self._index = 0

    @property
    def goal(self) -> Point | None:
        return self._waypoints[-1] if self._waypoints else None

    def remaining(self) -> list[Point]:
        return self._waypoints[self._index :]

    def next_command(self, pose: Pose) -> VelocityCommand | None:
        """None — путь пройден."""
        while self._index < len(self._waypoints):
            target = self._waypoints[self._index]
            is_last = self._index == len(self._waypoints) - 1
            reach = self._tolerance if is_last else self._tolerance * 2
            if distance_m(pose.point, target) <= reach:
                self._index += 1
                continue
            break
        if self._index >= len(self._waypoints):
            return None
        target = self._waypoints[self._index]
        bearing = math.atan2(target.y_m - pose.y_m, target.x_m - pose.x_m)
        error = normalize_angle(bearing - pose.heading_rad)
        angular = max(-self._max_angular, min(self._max_angular, 1.5 * error))
        if abs(error) > self._turn_in_place:
            return VelocityCommand(0.0, angular)
        slowdown = max(0.3, 1 - abs(error) / self._turn_in_place)
        return VelocityCommand(self._max_linear * slowdown, angular)


class StuckDetector:
    """Застревание: расстояние до цели не уменьшилось на `min_progress_m` за `window_s`."""

    def __init__(self, window_s: float = 6.0, min_progress_m: float = 0.05) -> None:
        self._window = window_s
        self._min_progress = min_progress_m
        self._best_distance: float | None = None
        self._best_at_s: float = 0.0

    def reset(self) -> None:
        self._best_distance = None

    def is_stuck(self, distance_to_goal_m: float, now_s: float) -> bool:
        if self._best_distance is None or distance_to_goal_m < self._best_distance - self._min_progress:
            self._best_distance = distance_to_goal_m
            self._best_at_s = now_s
            return False
        return now_s - self._best_at_s >= self._window
