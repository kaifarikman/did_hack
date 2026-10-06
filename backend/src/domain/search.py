"""Поиск образца по истории скалярного сигнала: градиент, IDW-прогноз и новизна."""
from __future__ import annotations

import math
from dataclasses import dataclass

from domain.geometry import Point, distance_m
from domain.subgoals import Candidate


@dataclass(frozen=True)
class _SignalSample:
    point: Point
    signal: float


class SignalSearch:
    """Хранит память исследователя одного прогона; новый прогон создаёт новый объект."""

    def __init__(self, min_sample_spacing_m: float = 0.15, gradient_window: int = 8) -> None:
        self._spacing = min_sample_spacing_m
        self._window = gradient_window
        self._history: list[_SignalSample] = []
        self._failed_collect_points: list[Point] = []
        self._collect_attempts = 0
        self._best_signal: float | None = None
        self._decisions_since_improvement = 0

    @property
    def best_signal(self) -> float | None:
        return self._best_signal

    @property
    def total_collect_attempts(self) -> int:
        return self._collect_attempts

    @property
    def decisions_since_improvement(self) -> int:
        return self._decisions_since_improvement

    def note_decision(self) -> None:
        self._decisions_since_improvement += 1

    def record_signal(self, point: Point, signal: float) -> None:
        if not self._history or distance_m(self._history[-1].point, point) >= self._spacing:
            self._history.append(_SignalSample(point, signal))
        if self._best_signal is None or signal > self._best_signal + 0.02:
            self._best_signal = signal
            self._decisions_since_improvement = 0

    def recent_signals(self, limit: int = 10) -> tuple[tuple[Point, float], ...]:
        return tuple((s.point, s.signal) for s in self._history[-limit:])

    def reset_after_collect(self) -> None:
        """После подтверждённого сбора сигнал относится к другому образцу: история устарела."""
        self._history.clear()
        self._best_signal = None
        self._decisions_since_improvement = 0
        self._failed_collect_points.clear()

    def record_collect_attempt(self, point: Point) -> None:
        self._collect_attempts += 1
        self._failed_collect_points.append(point)

    def collect_attempts_near(self, point: Point, radius_m: float = 0.3) -> int:
        return sum(1 for p in self._failed_collect_points if distance_m(p, point) <= radius_m)

    def _gradient(self) -> tuple[float, float] | None:
        """Наклон сигнала по методу наименьших квадратов на последних точках."""
        samples = self._history[-self._window :]
        if len(samples) < 3:
            return None
        mean_x = sum(s.point.x_m for s in samples) / len(samples)
        mean_y = sum(s.point.y_m for s in samples) / len(samples)
        mean_s = sum(s.signal for s in samples) / len(samples)
        sxx = sum((s.point.x_m - mean_x) ** 2 for s in samples)
        syy = sum((s.point.y_m - mean_y) ** 2 for s in samples)
        sxy = sum((s.point.x_m - mean_x) * (s.point.y_m - mean_y) for s in samples)
        sxs = sum((s.point.x_m - mean_x) * (s.signal - mean_s) for s in samples)
        sys_ = sum((s.point.y_m - mean_y) * (s.signal - mean_s) for s in samples)
        determinant = sxx * syy - sxy * sxy
        if determinant < 1e-6:
            return None
        return (sxs * syy - sys_ * sxy) / determinant, (sys_ * sxx - sxs * sxy) / determinant

    def _predicted_signal(self, point: Point) -> float:
        if not self._history:
            return 0.0
        weights = [1.0 / (distance_m(s.point, point) ** 2 + 0.05) for s in self._history]
        return sum(w * s.signal for w, s in zip(weights, self._history)) / sum(weights)

    def rank_candidates(
        self, reachable: list[Point], robot: Point, min_distance_m: float, max_distance_m: float,
        limit: int = 6,
    ) -> list[Candidate]:
        gradient = self._gradient()
        best = self._best_signal or 0.0
        signal_weight = 1.0 + 2.0 * best
        ranked = []
        for point in reachable:
            travel = distance_m(robot, point)
            if not min_distance_m <= travel <= max_distance_m:
                continue
            if any(distance_m(point, p) < 0.3 for p in self._failed_collect_points):
                continue
            predicted = self._predicted_signal(point)
            nearest_visited = min((distance_m(point, s.point) for s in self._history), default=1.5)
            novelty = min(nearest_visited, 1.5) / 1.5
            alignment = 0.0
            if gradient is not None and travel > 0:
                magnitude = math.hypot(*gradient)
                if magnitude > 1e-6:
                    direction = ((point.x_m - robot.x_m) / travel, (point.y_m - robot.y_m) / travel)
                    alignment = (direction[0] * gradient[0] + direction[1] * gradient[1]) / magnitude
            score = signal_weight * predicted + novelty + 0.5 * alignment - 0.05 * travel
            ranked.append(Candidate(point, score, predicted))
        ranked.sort(key=lambda candidate: candidate.score, reverse=True)
        return _spread(ranked, limit)


def _spread(ranked: list[Candidate], limit: int, min_gap_m: float = 0.5) -> list[Candidate]:
    """Отбирает лучшие кандидаты, не склеивая соседние клетки решётки."""
    chosen: list[Candidate] = []
    for candidate in ranked:
        if all(distance_m(candidate.point, other.point) >= min_gap_m for other in chosen):
            chosen.append(candidate)
            if len(chosen) == limit:
                break
    return chosen
