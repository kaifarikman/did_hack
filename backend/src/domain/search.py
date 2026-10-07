"""Поиск образцов по истории скалярного сигнала: градиент, IDW-прогноз, новизна и уточняющие пробы.

Сигнал без направления: близость к ближайшему несобранному образцу с шумом. Поэтому
- при слабом сигнале ценна новизна (разведка),
- при сильном — пробы на малом шаге вокруг робота, пока сигнал растёт (уточнение),
- сбор пробуется только на локальном максимуме, и число неудачных попыток ограничено,
- после подтверждённого сбора история сигнала относится к собранному образцу и сбрасывается,
- повторно выбранные цели штрафуются, чтобы поиск не ходил по кругу.
"""
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

    def __init__(
        self, min_sample_spacing_m: float = 0.15, gradient_window: int = 8, peak_radius_m: float = 0.4,
        peak_tolerance: float = 0.04, repeat_radius_m: float = 0.3, max_repeats: int = 2,
    ) -> None:
        self._spacing = min_sample_spacing_m
        self._window = gradient_window
        self._peak_radius = peak_radius_m
        self._peak_tolerance = peak_tolerance
        self._repeat_radius = repeat_radius_m
        self._max_repeats = max_repeats
        self._history: list[_SignalSample] = []
        self._recent_here: list[float] = []
        self._failed_collect_points: list[Point] = []
        self._targets: list[Point] = []
        self._collect_attempts = 0
        self._best_signal: float | None = None
        self._best_point: Point | None = None
        self._corrected_upto = 0  # с какого индекса истории измерения ещё не исправлены коррекцией позы
        self._decisions_since_improvement = 0

    @property
    def best_signal(self) -> float | None:
        return self._best_signal

    @property
    def best_point(self) -> Point | None:
        return self._best_point

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
            self._recent_here = [signal]
        else:
            self._recent_here = (self._recent_here + [signal])[-5:]
        if self._best_signal is None or signal > self._best_signal + 0.02:
            self._best_signal = signal
            self._best_point = point
            self._decisions_since_improvement = 0

    def recent_signals(self, limit: int = 10) -> tuple[tuple[Point, float], ...]:
        return tuple((s.point, s.signal) for s in self._history[-limit:])

    def reset_after_collect(self) -> None:
        """После подтверждённого сбора сигнал относится к другому образцу: история устарела."""
        self._history.clear()
        self._corrected_upto = 0
        self._recent_here.clear()
        self._best_signal = None
        self._best_point = None
        self._decisions_since_improvement = 0
        self._failed_collect_points.clear()
        self._targets.clear()

    def record_collect_attempt(self, point: Point) -> None:
        self._collect_attempts += 1
        self._failed_collect_points.append(point)

    def collect_attempts_near(self, point: Point, radius_m: float = 0.3) -> int:
        return sum(1 for p in self._failed_collect_points if distance_m(p, point) <= radius_m)

    def shift_since_correction(self, delta: Point) -> None:
        """Коррекция локализации: измерения после прошлой коррекции были в смещённой системе."""
        start = self._corrected_upto
        moved = lambda p: Point(p.x_m + delta.x_m, p.y_m + delta.y_m)  # noqa: E731
        self._history[start:] = [_SignalSample(moved(s.point), s.signal) for s in self._history[start:]]
        if self._best_point is not None:
            self._best_point = moved(self._best_point)
        self._corrected_upto = len(self._history)

    def note_target(self, point: Point) -> None:
        """Цель выбрана: повторный выбор той же точки считается признаком цикла."""
        self._targets.append(point)

    def repeats_near(self, point: Point) -> int:
        return sum(1 for target in self._targets if distance_m(target, point) <= self._repeat_radius)

    # ------------------------------------------------------------ оценки

    def local_signal(self) -> float | None:
        """Средний сигнал в текущей точке по последним показаниям (сглаживает шум)."""
        return sum(self._recent_here) / len(self._recent_here) if self._recent_here else None

    def at_peak(self, robot: Point) -> bool:
        """Здесь не слабее соседних измерений и есть хотя бы одно соседнее для сравнения."""
        here = self.local_signal()
        if here is None:
            return False
        neighbours = [
            sample.signal for sample in self._history[:-1]
            if distance_m(sample.point, robot) <= self._peak_radius
        ]
        return bool(neighbours) and here >= max(neighbours) - self._peak_tolerance

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

    def _alignment(self, robot: Point, point: Point, gradient: tuple[float, float] | None) -> float:
        travel = distance_m(robot, point)
        if gradient is None or travel <= 0:
            return 0.0
        magnitude = math.hypot(*gradient)
        if magnitude <= 1e-6:
            return 0.0
        direction = ((point.x_m - robot.x_m) / travel, (point.y_m - robot.y_m) / travel)
        return (direction[0] * gradient[0] + direction[1] * gradient[1]) / magnitude

    def _excluded(self, point: Point) -> bool:
        # неудачный сбор доказывает лишь отсутствие образца ближе 0.30 м к точке попытки;
        # образец может лежать чуть дальше, поэтому исключаем только саму точку
        near_failed = any(distance_m(point, p) < 0.15 for p in self._failed_collect_points)
        return near_failed or self.repeats_near(point) >= self._max_repeats

    def rank_candidates(
        self, reachable: list[Point], robot: Point, min_distance_m: float, max_distance_m: float,
        limit: int = 6, focus_signal: float | None = None, focus_radius_m: float = 1.2,
        frontier: list[Point] | tuple[Point, ...] = (),
    ) -> list[Candidate]:
        """Ценность поиска без учёта энергии: прогноз сигнала, новизна, направление градиента.

        При сильном лучшем сигнале (≥ focus_signal) поиск держится в радиусе `focus_radius_m`
        от точки лучшего сигнала: образец рядом, дальние прыжки только тратят энергию.
        Точки `frontier` (граница с неизвестным на карте SLAM) получают надбавку за открытие карты,
        которая убывает с ростом лучшего сигнала.
        """
        gradient = self._gradient()
        best = self._best_signal or 0.0
        signal_weight = 1.0 + 2.0 * best
        focus = self._best_point if focus_signal is not None and best >= focus_signal else None
        frontier_bonus = 0.6 * (1.0 - min(1.0, best))
        frontier_set = set(frontier)
        ranked = []
        for point in [*reachable, *frontier]:
            travel = distance_m(robot, point)
            if not min_distance_m <= travel <= max_distance_m or self._excluded(point):
                continue
            if focus is not None and distance_m(point, focus) > focus_radius_m:
                continue
            predicted = self._predicted_signal(point)
            nearest_visited = min((distance_m(point, s.point) for s in self._history), default=1.5)
            novelty = min(nearest_visited, 1.5) / 1.5
            repeat_penalty = 0.5 * self.repeats_near(point)
            score = (signal_weight * predicted + novelty + 0.5 * self._alignment(robot, point, gradient)
                     - repeat_penalty + (frontier_bonus if point in frontier_set else 0.0))
            ranked.append(Candidate(point, score, predicted))
        ranked.sort(key=lambda candidate: candidate.score, reverse=True)
        return _spread(ranked, limit)

    def refine_candidates(self, center: Point, step_m: float, is_reachable, directions: int = 8) -> list[Candidate]:
        """Шаблонный поиск: пробы на шаге `step_m` вокруг точки лучшего сигнала.

        Уже измеренные направления (ближе половины шага к прежним измерениям) не повторяются;
        когда все обойдены, вызывающий уменьшает шаг или переходит к сбору/разведке.
        """
        gradient = self._gradient()
        ranked = []
        for index in range(directions):
            angle = 2 * math.pi * index / directions
            point = Point(center.x_m + step_m * math.cos(angle), center.y_m + step_m * math.sin(angle))
            if not is_reachable(point) or self._excluded(point):
                continue
            measured_near = min((distance_m(point, s.point) for s in self._history), default=step_m)
            if measured_near < step_m / 2:
                continue
            predicted = self._predicted_signal(point)
            score = predicted + 0.3 * self._alignment(center, point, gradient)
            ranked.append(Candidate(point, score, predicted))
        ranked.sort(key=lambda candidate: candidate.score, reverse=True)
        return ranked[:3]


def _spread(ranked: list[Candidate], limit: int, min_gap_m: float = 0.5) -> list[Candidate]:
    """Отбирает лучшие кандидаты, не склеивая соседние клетки решётки."""
    chosen: list[Candidate] = []
    for candidate in ranked:
        if all(distance_m(candidate.point, other.point) >= min_gap_m for other in chosen):
            chosen.append(candidate)
            if len(chosen) == limit:
                break
    return chosen
