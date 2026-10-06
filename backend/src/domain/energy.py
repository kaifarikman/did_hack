"""Оценка расхода энергии на метр по наблюдениям (карта стоимостей по корзинам)."""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from domain.geometry import Point, distance_m


@dataclass(frozen=True)
class TravelSegment:
    start: Point
    end: Point
    distance_m: float
    battery_drop: float
    duration_s: float
    rotation_rad: float = 0.0
    penalty_flagged: bool = False


@dataclass(frozen=True)
class TerrainEstimate:
    energy_per_m: float
    confidence: float
    measured: bool


@dataclass(frozen=True)
class _Sample:
    sequence: int
    bucket: tuple[int, int]
    distance_m: float
    energy: float


class TerrainEstimator:
    """Не использует истинную разметку: только пройденное расстояние и падение батареи.

    Неизмеренная область получает консервативный prior, а не ноль.
    """

    def __init__(
        self,
        bucket_size_m: float = 0.5,
        min_segment_m: float = 0.3,
        max_rotation_rad: float = 1.0,
        prior_energy_per_m: float = 1.5,
        prior_weight_m: float = 0.3,
        uncertainty_margin: float = 0.5,
        full_confidence_distance_m: float = 2.0,
    ) -> None:
        self._bucket_size_m = bucket_size_m
        self._min_segment_m = min_segment_m
        self._max_rotation_rad = max_rotation_rad
        self._prior = prior_energy_per_m
        self._prior_weight_m = prior_weight_m
        self._margin = uncertainty_margin
        self._full_confidence_m = full_confidence_distance_m
        self._samples: list[_Sample] = []
        self._totals: dict[tuple[int, int], list[float]] = {}  # bucket -> [distance, energy]
        self._sequence = 0

    @property
    def revision(self) -> int:
        return self._sequence

    @property
    def prior_energy_per_m(self) -> float:
        return self._prior

    def bucket_of(self, point: Point) -> tuple[int, int]:
        return (
            math.floor(point.x_m / self._bucket_size_m),
            math.floor(point.y_m / self._bucket_size_m),
        )

    def bucket_center(self, bucket: tuple[int, int]) -> Point:
        return Point((bucket[0] + 0.5) * self._bucket_size_m, (bucket[1] + 0.5) * self._bucket_size_m)

    def record(self, segment: TravelSegment) -> bool:
        """Принимает только чистые отрезки: достаточной длины, без штрафа и сильного вращения."""
        if segment.distance_m < self._min_segment_m or segment.battery_drop < 0:
            return False
        if segment.penalty_flagged or segment.rotation_rad > self._max_rotation_rad:
            return False
        midpoint = Point(
            (segment.start.x_m + segment.end.x_m) / 2, (segment.start.y_m + segment.end.y_m) / 2
        )
        bucket = self.bucket_of(midpoint)
        self._sequence += 1
        self._samples.append(_Sample(self._sequence, bucket, segment.distance_m, segment.battery_drop))
        total = self._totals.setdefault(bucket, [0.0, 0.0])
        total[0] += segment.distance_m
        total[1] += segment.battery_drop
        return True

    def _bucket_estimate(self, bucket: tuple[int, int]) -> TerrainEstimate:
        total = self._totals.get(bucket)
        if total is None:
            return TerrainEstimate(self._prior, 0.0, False)
        distance, energy = total
        value = (energy + self._prior * self._prior_weight_m) / (distance + self._prior_weight_m)
        return TerrainEstimate(value, min(1.0, distance / self._full_confidence_m), True)

    def estimate_at(self, point: Point) -> TerrainEstimate:
        return self._bucket_estimate(self.bucket_of(point))

    def conservative_energy_per_m(self, point: Point) -> float:
        estimate = self.estimate_at(point)
        return estimate.energy_per_m * (1 + self._margin * (1 - estimate.confidence))

    def baseline_energy_per_m(self) -> float | None:
        """Медиана по измеренным корзинам; нужна минимум пара корзин для сравнения."""
        values = [self._bucket_estimate(bucket).energy_per_m for bucket in self._totals]
        return statistics.median(values) if len(values) >= 2 else None

    def measured_buckets(self) -> list[tuple[int, int]]:
        return list(self._totals)

    def estimate_for_bucket(self, bucket: tuple[int, int]) -> TerrainEstimate:
        return self._bucket_estimate(bucket)

    def energy_per_m_since(
        self, bucket: tuple[int, int], sequence: int
    ) -> tuple[float, float] | None:
        """(расход на метр, дистанция) по отрезкам в корзине, записанным после `sequence`."""
        fresh = [s for s in self._samples if s.bucket == bucket and s.sequence > sequence]
        distance = sum(s.distance_m for s in fresh)
        if distance <= 0:
            return None
        return sum(s.energy for s in fresh) / distance, distance

    def regions(self) -> list[tuple[str, Point, float, float, float]]:
        """(id, центр, радиус, расход/м, уверенность) для публикации оценок агента."""
        result = []
        for bucket in sorted(self._totals):
            estimate = self._bucket_estimate(bucket)
            result.append(
                (
                    f"cell-{bucket[0]}-{bucket[1]}",
                    self.bucket_center(bucket),
                    self._bucket_size_m / 2,
                    estimate.energy_per_m,
                    estimate.confidence,
                )
            )
        return result

    def path_energy(self, start: Point, waypoints: list[Point], safety_factor: float = 1.0) -> float:
        """Консервативная оценка расхода вдоль ломаной (дробит отрезки по половине корзины)."""
        total, previous = 0.0, start
        step = self._bucket_size_m / 2
        for waypoint in waypoints:
            length = distance_m(previous, waypoint)
            pieces = max(1, math.ceil(length / step))
            for piece in range(pieces):
                fraction = (piece + 0.5) / pieces
                probe = Point(
                    previous.x_m + (waypoint.x_m - previous.x_m) * fraction,
                    previous.y_m + (waypoint.y_m - previous.y_m) * fraction,
                )
                total += (length / pieces) * self.conservative_energy_per_m(probe)
            previous = waypoint
        return total * safety_factor
