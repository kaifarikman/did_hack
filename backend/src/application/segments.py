"""Нарезка наблюдений на отрезки измерения расхода.

Батарея публикуется реже позы. Отрезок закрывается только на наблюдении, где значение батареи
обновилось: поза и батарея на границе отрезка относятся к одному моменту, а не к разным
сообщениям. Время отрезка — по часам симуляции, если они есть.
"""
from __future__ import annotations

from domain.energy import TravelSegment
from domain.geometry import Point, distance_m, normalize_angle
from domain.observations import Observation

PATH_STEP_M = 0.02


class SegmentAccumulator:
    def __init__(self, min_length_m: float = 0.3, max_duration_s: float = 30.0) -> None:
        self._min_length_m = min_length_m
        self._max_duration_s = max_duration_s
        self._last: Observation | None = None
        self._start: Observation | None = None
        self._start_time_s = 0.0
        self._last_time_s = 0.0
        self._path: list[Point] = []
        self._distance = 0.0
        self._rotation = 0.0
        self._penalty = False

    def _restart(self, observation: Observation, now_s: float) -> None:
        self._start, self._start_time_s = observation, now_s
        self._path = [observation.pose.point]
        self._distance = self._rotation = 0.0
        self._penalty = False

    def discard(self) -> None:
        """Отрезок с неизвестным вмешательством (сбор, остановка) не пригоден для оценки."""
        self._start = None

    def add(self, observation: Observation, monotonic_s: float, penalty: bool) -> TravelSegment | None:
        now_s = observation.simulation_time_s if observation.simulation_time_s is not None else monotonic_s
        previous, self._last = self._last, observation
        battery_updated = previous is not None and previous.battery_remaining != observation.battery_remaining
        if self._start is None:
            if previous is None or battery_updated:
                self._restart(observation, now_s)
            return None
        step = distance_m(previous.pose.point, observation.pose.point)
        self._distance += step
        self._rotation += abs(normalize_angle(observation.pose.heading_rad - previous.pose.heading_rad))
        if distance_m(self._path[-1], observation.pose.point) >= PATH_STEP_M:
            self._path.append(observation.pose.point)
        self._penalty = self._penalty or penalty
        if not battery_updated:
            return None
        duration = now_s - self._start_time_s
        if self._distance < self._min_length_m and duration < self._max_duration_s:
            return None
        if self._path[-1] != observation.pose.point:
            self._path.append(observation.pose.point)
        segment = TravelSegment(
            start=self._start.pose.point,
            end=observation.pose.point,
            distance_m=self._distance,
            battery_drop=self._start.battery_remaining - observation.battery_remaining,
            duration_s=duration,
            rotation_rad=self._rotation,
            penalty_flagged=self._penalty,
            path=tuple(self._path),
            simulation_time_s=observation.simulation_time_s,
        )
        self._restart(observation, now_s)
        return segment
