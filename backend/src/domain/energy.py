"""Модель расхода энергии по наблюдениям: стоимость метра по корзинам, повороты и простой.

Не использует истинную разметку: только пройденный путь, повороты, время и падение батареи.

Модель отрезка: `падение = Σ d_b·c_b + k_rot·поворот + k_idle·время`, где d_b — путь внутри
корзины b. Оценки находятся регуляризованным МНК по всем чистым отрезкам текущего режима:
отрезок через несколько корзин делит расход по фактическому пути в каждой, а не относит его
к средней точке. Prior — псевдоизмерение длиной `prior_weight_m` с ценой prior. Шум считается
одинаковым для отрезка (квантование и выравнивание батареи), поэтому длинный отрезок весит больше.

Смена режима корзины (`open_regime`) исключает старые отрезки из оценки, но сохраняет их для
журнала: новое измерение не подавляется историей до изменения.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from domain.geometry import Point, distance_m

Bucket = tuple[int, int]


@dataclass(frozen=True)
class TravelSegment:
    start: Point
    end: Point
    distance_m: float
    battery_drop: float
    duration_s: float
    rotation_rad: float = 0.0
    penalty_flagged: bool = False
    path: tuple[Point, ...] = ()  # позы отрезка по порядку; пусто — прямая start→end
    simulation_time_s: float | None = None  # время окончания по часам симуляции


@dataclass(frozen=True)
class TerrainEstimate:
    energy_per_m: float
    confidence: float  # достаточность подтверждений: путь текущего режима / полный путь доверия
    measured: bool
    std_energy_per_m: float = 0.0  # неопределённость оценки
    distance_m: float = 0.0  # путь в корзине в текущем режиме
    regime: int = 0  # номер режима; растёт при обнаруженном изменении
    last_measured_s: float | None = None  # время симуляции последнего измерения


@dataclass(frozen=True)
class SegmentRecord:
    """Принятый отрезок: разложение по корзинам и номер для независимых проверок."""

    sequence: int
    pieces: tuple[tuple[Bucket, float], ...]
    battery_drop: float
    rotation_rad: float
    duration_s: float
    simulation_time_s: float | None

    @property
    def distance_m(self) -> float:
        return sum(length for _, length in self.pieces)

    def dominant(self) -> tuple[Bucket, float]:
        """Корзина с наибольшим путём и её доля."""
        bucket, length = max(self.pieces, key=lambda piece: piece[1])
        total = self.distance_m
        return bucket, (length / total if total > 0 else 0.0)


class TerrainEstimator:
    """Неизмеренная область получает консервативный prior, а не ноль."""

    def __init__(
        self,
        bucket_size_m: float = 0.5,
        min_segment_m: float = 0.3,
        max_rotation_rad: float = 6.0,
        prior_energy_per_m: float = 1.5,
        prior_weight_m: float = 0.15,
        prior_std_energy_per_m: float = 0.75,
        prior_rotation_energy_per_rad: float = 0.1,
        prior_idle_energy_per_s: float = 0.0,
        measurement_noise: float = 0.05,
        full_confidence_distance_m: float = 2.0,
        uncertainty_z: float = 1.0,
    ) -> None:
        self._bucket_size_m = bucket_size_m
        self._min_segment_m = min_segment_m
        self._max_rotation_rad = max_rotation_rad
        self._prior = prior_energy_per_m
        self._prior_weight_m = prior_weight_m
        self._prior_std = prior_std_energy_per_m
        self._prior_rotation = prior_rotation_energy_per_rad
        self._prior_idle = prior_idle_energy_per_s
        self._noise = measurement_noise
        self._full_confidence_m = full_confidence_distance_m
        self._z = uncertainty_z
        self._records: list[SegmentRecord] = []
        self._regime: dict[Bucket, tuple[int, int]] = {}  # bucket -> (номер режима, первый sequence)
        self._sequence = 0
        self._estimates: dict[Bucket, TerrainEstimate] = {}
        self._rotation_energy = prior_rotation_energy_per_rad
        self._idle_energy = prior_idle_energy_per_s
        self._residual_std = measurement_noise

    # ---------------------------------------------------------------- свойства

    @property
    def revision(self) -> int:
        return self._sequence

    @property
    def bucket_size_m(self) -> float:
        return self._bucket_size_m

    @property
    def prior_energy_per_m(self) -> float:
        return self._prior

    @property
    def rotation_energy_per_rad(self) -> float:
        return self._rotation_energy

    @property
    def idle_energy_per_s(self) -> float:
        return self._idle_energy

    @property
    def residual_std(self) -> float:
        return self._residual_std

    @property
    def records(self) -> tuple[SegmentRecord, ...]:
        return tuple(self._records)

    def bucket_of(self, point: Point) -> Bucket:
        return (
            math.floor(point.x_m / self._bucket_size_m),
            math.floor(point.y_m / self._bucket_size_m),
        )

    def bucket_center(self, bucket: Bucket) -> Point:
        return Point((bucket[0] + 0.5) * self._bucket_size_m, (bucket[1] + 0.5) * self._bucket_size_m)

    # ---------------------------------------------------------------- запись

    def split(self, path: tuple[Point, ...]) -> tuple[tuple[Bucket, float], ...]:
        """Путь ломаной внутри каждой корзины (шаг дробления — десятая часть корзины)."""
        lengths: dict[Bucket, float] = {}
        step = self._bucket_size_m / 10
        for first, second in zip(path, path[1:]):
            length = distance_m(first, second)
            pieces = max(1, math.ceil(length / step))
            for piece in range(pieces):
                fraction = (piece + 0.5) / pieces
                probe = Point(
                    first.x_m + (second.x_m - first.x_m) * fraction,
                    first.y_m + (second.y_m - first.y_m) * fraction,
                )
                bucket = self.bucket_of(probe)
                lengths[bucket] = lengths.get(bucket, 0.0) + length / pieces
        return tuple(sorted(lengths.items()))

    def record(self, segment: TravelSegment) -> SegmentRecord | None:
        """Принимает чистый отрезок: достаточной длины, без штрафа, с правдоподобным падением батареи."""
        if segment.distance_m < self._min_segment_m or segment.battery_drop < 0:
            return None
        if segment.penalty_flagged or segment.rotation_rad > self._max_rotation_rad:
            return None
        path = segment.path if len(segment.path) >= 2 else (segment.start, segment.end)
        pieces = self.split(path)
        if not pieces:
            return None
        self._sequence += 1
        record = SegmentRecord(self._sequence, pieces, segment.battery_drop, segment.rotation_rad,
                               segment.duration_s, segment.simulation_time_s)
        self._records.append(record)
        for bucket, _ in pieces:
            self._regime.setdefault(bucket, (0, 0))
        self._solve()
        return record

    def open_regime(self, bucket: Bucket, from_sequence: int) -> None:
        """Новый режим корзины: отрезки с sequence < from_sequence больше не влияют на её оценку."""
        number, _ = self._regime.get(bucket, (0, 0))
        self._regime[bucket] = (number + 1, from_sequence)
        self._sequence += 1  # версия модели растёт: маршруты и запас пересчитываются
        self._solve()

    def regime_of(self, bucket: Bucket) -> int:
        return self._regime.get(bucket, (0, 0))[0]

    # ---------------------------------------------------------------- оценка

    def _active(self, record: SegmentRecord) -> bool:
        return all(record.sequence >= self._regime.get(bucket, (0, 0))[1] for bucket, _ in record.pieces)

    def _solve(self) -> None:
        records = [record for record in self._records if self._active(record)]
        buckets = sorted({bucket for record in records for bucket, _ in record.pieces})
        index = {bucket: position for position, bucket in enumerate(buckets)}
        size = len(buckets) + 2  # + энергия поворота + энергия простоя
        rotation_at, idle_at = len(buckets), len(buckets) + 1
        normal = [[0.0] * size for _ in range(size)]
        rhs = [0.0] * size

        def add_row(coefficients: dict[int, float], value: float) -> None:
            for row, first in coefficients.items():
                rhs[row] += first * value
                for column, second in coefficients.items():
                    normal[row][column] += first * second

        for record in records:
            coefficients = {index[bucket]: length for bucket, length in record.pieces}
            coefficients[rotation_at] = record.rotation_rad
            coefficients[idle_at] = record.duration_s
            add_row(coefficients, record.battery_drop)
        for position in range(len(buckets)):
            add_row({position: self._prior_weight_m}, self._prior_weight_m * self._prior)
        # поворот и простой: сильный prior, сдвигается только устойчивыми данными
        add_row({rotation_at: 3.0}, 3.0 * self._prior_rotation)
        add_row({idle_at: 30.0}, 30.0 * self._prior_idle)

        solution, inverse_diagonal = _solve_with_inverse_diagonal(normal, rhs)
        self._rotation_energy = max(0.0, solution[rotation_at])
        self._idle_energy = max(0.0, solution[idle_at])
        residuals = [
            record.battery_drop - sum(length * solution[index[bucket]] for bucket, length in record.pieces)
            - record.rotation_rad * solution[rotation_at] - record.duration_s * solution[idle_at]
            for record in records
        ]
        degrees = max(1, len(records) - len(buckets) // 2)
        variance = sum(value * value for value in residuals) / degrees if residuals else 0.0
        self._residual_std = max(self._noise, math.sqrt(variance))

        distances: dict[Bucket, float] = {}
        last_time: dict[Bucket, float | None] = {}
        for record in records:
            for bucket, length in record.pieces:
                distances[bucket] = distances.get(bucket, 0.0) + length
                last_time[bucket] = record.simulation_time_s
        self._estimates = {}
        for bucket in buckets:
            position = index[bucket]
            distance = distances.get(bucket, 0.0)
            statistical = self._residual_std * math.sqrt(max(0.0, inverse_diagonal[position]))
            shrinking = self._prior_std * self._prior_weight_m / (self._prior_weight_m + distance)
            self._estimates[bucket] = TerrainEstimate(
                energy_per_m=max(0.0, solution[position]),
                confidence=min(1.0, distance / self._full_confidence_m),
                measured=True,
                std_energy_per_m=max(statistical, shrinking),
                distance_m=distance,
                regime=self.regime_of(bucket),
                last_measured_s=last_time.get(bucket),
            )

    def _bucket_estimate(self, bucket: Bucket) -> TerrainEstimate:
        estimate = self._estimates.get(bucket)
        if estimate is None:
            return TerrainEstimate(self._prior, 0.0, False, self._prior_std, 0.0, self.regime_of(bucket))
        return estimate

    def estimate_at(self, point: Point) -> TerrainEstimate:
        return self._bucket_estimate(self.bucket_of(point))

    def estimate_for_bucket(self, bucket: Bucket) -> TerrainEstimate:
        return self._bucket_estimate(bucket)

    def conservative_energy_per_m(self, point: Point) -> float:
        estimate = self.estimate_at(point)
        return estimate.energy_per_m + self._z * estimate.std_energy_per_m

    def predicted_drop(self, record: SegmentRecord, excluding: Bucket | None = None) -> float:
        """Прогноз падения батареи по текущей модели; `excluding` — корзина вне прогноза."""
        terrain = sum(
            length * self._bucket_estimate(bucket).energy_per_m
            for bucket, length in record.pieces if bucket != excluding
        )
        return terrain + record.rotation_rad * self._rotation_energy + record.duration_s * self._idle_energy

    def baseline_energy_per_m(self) -> float | None:
        """Медиана по корзинам с достаточным путём; нужна минимум пара корзин для сравнения."""
        values = [
            estimate.energy_per_m for estimate in self._estimates.values()
            if estimate.distance_m >= self._min_segment_m
        ]
        return statistics.median(values) if len(values) >= 2 else None

    def measured_buckets(self) -> list[Bucket]:
        return [bucket for bucket, estimate in self._estimates.items() if estimate.distance_m > 0]

    def energy_per_m_since(self, bucket: Bucket, sequence: int, min_share: float = 0.5) -> tuple[float, float] | None:
        """(расход на метр в корзине, путь в ней) только по отрезкам, записанным после `sequence`.

        Расход отрезка очищается от поворотов, простоя и пути в других корзинах по текущей модели;
        учитываются отрезки, где корзина занимает не меньше `min_share` пути. Это независимая проверка:
        отрезки до начала эксперимента в неё не входят.
        """
        energy = distance = 0.0
        for record in self._records:
            if record.sequence <= sequence:
                continue
            inside = sum(length for piece, length in record.pieces if piece == bucket)
            if inside <= 0 or inside / record.distance_m + 1e-9 < min_share:
                continue
            energy += record.battery_drop - self.predicted_drop(record, excluding=bucket)
            distance += inside
        if distance <= 0:
            return None
        return max(0.0, energy) / distance, distance

    def regions(self) -> list[tuple[str, Point, float, float, float]]:
        """(id, центр, радиус, расход/м, уверенность) для публикации оценок агента."""
        return [
            (f"cell-{bucket[0]}-{bucket[1]}", self.bucket_center(bucket), self._bucket_size_m / 2,
             estimate.energy_per_m, estimate.confidence)
            for bucket, estimate in sorted(self._estimates.items())
        ]

    def detailed_regions(self) -> list[tuple[str, Bucket, TerrainEstimate]]:
        return [(f"cell-{bucket[0]}-{bucket[1]}", bucket, estimate) for bucket, estimate in sorted(self._estimates.items())]

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


def _solve_with_inverse_diagonal(matrix: list[list[float]], rhs: list[float]) -> tuple[list[float], list[float]]:
    """Решение симметричной положительно определённой системы и диагональ обратной матрицы (Гаусс–Жордан)."""
    size = len(rhs)
    augmented = [row[:] + [rhs[i]] + [1.0 if i == j else 0.0 for j in range(size)] for i, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        lead = augmented[column][column]
        if abs(lead) < 1e-12:
            continue
        augmented[column] = [value / lead for value in augmented[column]]
        for row in range(size):
            if row != column and augmented[row][column] != 0.0:
                factor = augmented[row][column]
                augmented[row] = [a - factor * b for a, b in zip(augmented[row], augmented[column])]
    solution = [augmented[i][size] for i in range(size)]
    inverse_diagonal = [augmented[i][size + 1 + i] for i in range(size)]
    return solution, inverse_diagonal
