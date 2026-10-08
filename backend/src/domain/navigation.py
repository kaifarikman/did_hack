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
        start: Point | None = None,
    ) -> None:
        self._waypoints = list(waypoints)
        self._tolerance = tolerance_m
        self._max_linear = max_linear_mps
        self._max_angular = max_angular_radps
        self._turn_in_place = turn_in_place_rad
        self._start = start
        self._index = 0
        self._furthest_progress_m = 0.0

    @property
    def waypoint_index(self) -> int:
        return self._index

    @property
    def goal(self) -> Point | None:
        return self._waypoints[-1] if self._waypoints else None

    def remaining(self) -> list[Point]:
        return self._waypoints[self._index :]

    def progress_m(self, pose: Pose) -> float:
        """Monotonic distance projected along the traversed route, excluding turns and waits."""
        if not self._waypoints:
            return 0.0
        start = self._start or pose.point
        progress = 0.0
        for waypoint in self._waypoints[:self._index]:
            progress += distance_m(start, waypoint)
            start = waypoint
        if self._index < len(self._waypoints):
            end = self._waypoints[self._index]
            dx, dy = end.x_m - start.x_m, end.y_m - start.y_m
            length = math.hypot(dx, dy)
            if length > 1e-9:
                projection = ((pose.x_m - start.x_m) * dx + (pose.y_m - start.y_m) * dy) / length
                progress += max(0.0, min(length, projection))
        else:
            progress = sum(distance_m(a, b) for a, b in zip(self._waypoints, self._waypoints[1:]))
            if self._start is not None:
                progress += distance_m(self._start, self._waypoints[0])
        self._furthest_progress_m = max(self._furthest_progress_m, progress)
        return self._furthest_progress_m

    def next_command(self, pose: Pose) -> VelocityCommand | None:
        """None — путь пройден."""
        if self._index < len(self._waypoints):
            target = self._waypoints[self._index]
            is_last = self._index == len(self._waypoints) - 1
            reach = self._tolerance if is_last else self._tolerance * 2
            if distance_m(pose.point, target) <= reach:
                self._index += 1
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

    def cross_track_error_m(self, pose: Pose) -> float:
        """Distance to the active path segment, not to any convenient future segment."""
        if not self._waypoints or self._index >= len(self._waypoints):
            return 0.0
        if self._index == 0:
            if self._start is None:
                self._start = pose.point
            start = self._start
        else:
            start = self._waypoints[self._index - 1]
        end = self._waypoints[self._index]
        delta_x, delta_y = end.x_m - start.x_m, end.y_m - start.y_m
        length_squared = delta_x * delta_x + delta_y * delta_y
        if length_squared <= 1e-12:
            return distance_m(pose.point, end)
        projection = ((pose.x_m - start.x_m) * delta_x + (pose.y_m - start.y_m) * delta_y) / length_squared
        projection = max(0.0, min(1.0, projection))
        nearest = Point(start.x_m + projection * delta_x, start.y_m + projection * delta_y)
        return distance_m(pose.point, nearest)


class PathDeviationDetector:
    """Requires sustained deviation, applies hysteresis, and rate-limits replans."""

    def __init__(self, tolerance_m: float, hysteresis_m: float,
                 confirmation_s: float, cooldown_s: float) -> None:
        self._tolerance = max(0.0, tolerance_m)
        self._reset_threshold = max(0.0, self._tolerance - max(0.0, hysteresis_m))
        self._confirmation_s = max(0.0, confirmation_s)
        self._cooldown_s = max(0.0, cooldown_s)
        self._outside_since_s: float | None = None
        self._cooldown_until_s = 0.0

    def reset_confirmation(self) -> None:
        self._outside_since_s = None

    def is_deviated(self, cross_track_error_m: float, now_s: float) -> bool:
        if now_s < self._cooldown_until_s:
            self._outside_since_s = None
            return False
        if cross_track_error_m <= self._reset_threshold:
            self._outside_since_s = None
            return False
        if cross_track_error_m <= self._tolerance:
            return False
        if self._outside_since_s is None:
            self._outside_since_s = now_s
            return False
        if now_s - self._outside_since_s < self._confirmation_s:
            return False
        self._outside_since_s = None
        self._cooldown_until_s = now_s + self._cooldown_s
        return True


class StuckDetector:
    """Detect missing along-route progress only while translation is commanded."""

    def __init__(self, window_s: float = 6.0, min_progress_m: float = 0.05) -> None:
        self._window = window_s
        self._min_progress = min_progress_m
        self._best_progress_m: float | None = None
        self._best_at_s: float = 0.0
        self._paused_at_s: float | None = None

    def reset(self) -> None:
        self._best_progress_m = None
        self._paused_at_s = None

    def is_stuck(self, path_progress_m: float, now_s: float, translating: bool = True) -> bool:
        if not translating:
            if self._paused_at_s is None:
                self._paused_at_s = now_s
            return False
        if self._paused_at_s is not None:
            self._best_at_s += max(0.0, now_s - self._paused_at_s)
            self._paused_at_s = None
        if self._best_progress_m is None or path_progress_m > self._best_progress_m + self._min_progress:
            self._best_progress_m = path_progress_m
            self._best_at_s = now_s
            return False
        return now_s - self._best_at_s >= self._window
