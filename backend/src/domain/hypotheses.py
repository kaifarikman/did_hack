"""Гипотезы о грунте: прогноз до действия → проверка → независимые измерения → вывод.

Гипотеза хранит численный прогноз и критерий, записанные **до** проверочного проезда, и
номера измерений, из которых она возникла. Проверка использует только отрезки после начала
эксперимента. Исходы: подтверждается, опровергается, недостаточно данных, отложено.
«Подтверждается» означает согласие с измерениями в этих условиях, а не закон природы.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum

from domain.energy import Bucket, TerrainEstimator
from domain.geometry import Point


class HypothesisKind(str, Enum):
    COSTLY_TERRAIN = "costly_terrain"  # участок дороже базовой линии
    TERRAIN_CHANGE = "terrain_change"  # стоимость участка изменилась по сравнению с прежним режимом


class HypothesisStatus(str, Enum):
    PROPOSED = "proposed"
    TESTING = "testing"
    CONFIRMED = "confirmed"
    REFUTED = "refuted"
    DEFERRED = "deferred"
    UNVERIFIED = "unverified"  # недостаточно данных после лимита попыток

    @property
    def is_conclusion(self) -> bool:
        return self in (HypothesisStatus.CONFIRMED, HypothesisStatus.REFUTED, HypothesisStatus.UNVERIFIED)


@dataclass(frozen=True)
class Prediction:
    """Численный прогноз измерения проверки: значение и границы для решения (ед./м)."""

    expected: float
    confirm_at_least: float | None = None  # подтверждение, если измерение не ниже
    confirm_at_most: float | None = None  # подтверждение, если измерение не выше

    def describe(self) -> str:
        if self.confirm_at_least is not None:
            return f"расход ≈ {self.expected:.2f} ед./м, подтверждение при ≥ {self.confirm_at_least:.2f}"
        return f"расход ≈ {self.expected:.2f} ед./м, подтверждение при ≤ {self.confirm_at_most:.2f}"


@dataclass
class Hypothesis:
    hypothesis_id: str
    kind: HypothesisKind
    bucket: Bucket
    center: Point
    baseline_energy_per_m: float  # с чем сравниваем: базовая линия или прежний режим
    observed_energy_per_m: float  # оценка, породившая гипотезу
    prediction: Prediction
    alternative: str  # альтернативное объяснение, которое проверка должна отделить
    evidence: tuple[int, ...]  # номера отрезков, из которых возникла гипотеза; в проверку не входят
    detection_id: str | None = None
    status: HypothesisStatus = HypothesisStatus.PROPOSED
    started_after_sequence: int = 0
    attempts: int = 0
    measured_energy_per_m: float | None = None
    measured_distance_m: float = 0.0
    measurement_std: float | None = None
    experiment_ids: list[str] = field(default_factory=list)

    @property
    def expected_energy_per_m(self) -> float:
        return self.prediction.expected

    @property
    def experiment_id(self) -> str | None:
        return self.experiment_ids[-1] if self.experiment_ids else None


class HypothesisBook:
    def __init__(
        self, elevated_ratio: float = 1.5, min_confidence: float = 0.1,
        min_verify_distance_m: float = 0.3, max_attempts: int = 2, confirm_ratio: float = 1.3,
        ambiguity_sigmas: float = 1.0,
    ) -> None:
        self._elevated_ratio = elevated_ratio
        self._min_confidence = min_confidence
        self._min_verify_distance = min_verify_distance_m
        self._max_attempts = max_attempts
        self._confirm_ratio = confirm_ratio
        self._ambiguity_sigmas = ambiguity_sigmas
        self._items: list[Hypothesis] = []
        self._experiments = 0

    @property
    def items(self) -> tuple[Hypothesis, ...]:
        return tuple(self._items)

    def find(self, hypothesis_id: str) -> Hypothesis | None:
        return next((item for item in self._items if item.hypothesis_id == hypothesis_id), None)

    def active(self) -> Hypothesis | None:
        for item in self._items:
            if item.status in (HypothesisStatus.PROPOSED, HypothesisStatus.TESTING):
                return item
        return None

    def confirm_threshold(self, item: Hypothesis) -> float:
        prediction = item.prediction
        return prediction.confirm_at_least if prediction.confirm_at_least is not None else prediction.confirm_at_most

    def _next_id(self) -> str:
        return f"hypothesis-{len(self._items) + 1}"

    def _evidence(self, estimator: TerrainEstimator, bucket: Bucket) -> tuple[int, ...]:
        return tuple(
            record.sequence for record in estimator.records
            if any(piece == bucket for piece, _ in record.pieces)
        )

    def propose(self, estimator: TerrainEstimator) -> Hypothesis | None:
        """Новая гипотеза: самая дорогая корзина заметно дороже базовой линии остальных измеренных."""
        baseline = estimator.baseline_energy_per_m()
        if baseline is None or self.active() is not None:
            return None
        known = {item.bucket for item in self._items if item.kind is HypothesisKind.COSTLY_TERRAIN}
        candidates = [
            (bucket, estimator.estimate_for_bucket(bucket)) for bucket in estimator.measured_buckets()
            if bucket not in known
        ]
        candidates = [
            (bucket, estimate) for bucket, estimate in candidates
            if estimate.confidence >= self._min_confidence and estimate.energy_per_m >= self._elevated_ratio * baseline
        ]
        if not candidates:
            return None
        bucket, estimate = max(candidates, key=lambda item: item[1].energy_per_m)
        item = Hypothesis(
            hypothesis_id=self._next_id(),
            kind=HypothesisKind.COSTLY_TERRAIN,
            bucket=bucket,
            center=estimator.bucket_center(bucket),
            baseline_energy_per_m=baseline,
            observed_energy_per_m=estimate.energy_per_m,
            prediction=Prediction(estimate.energy_per_m, confirm_at_least=self._confirm_ratio * baseline),
            alternative="повышенный расход объясняется поворотами, штрафом или соседней ячейкой",
            evidence=self._evidence(estimator, bucket),
        )
        self._items.append(item)
        return item

    def propose_change(
        self, estimator: TerrainEstimator, bucket: Bucket, old_level: float, new_level: float,
        evidence: tuple[int, ...], detection_id: str,
    ) -> Hypothesis:
        """Гипотеза об изменении грунта после обнаружения: проверяется новыми независимыми отрезками."""
        midpoint = (old_level + new_level) / 2
        rising = new_level > old_level
        item = Hypothesis(
            hypothesis_id=self._next_id(),
            kind=HypothesisKind.TERRAIN_CHANGE,
            bucket=bucket,
            center=estimator.bucket_center(bucket),
            baseline_energy_per_m=old_level,
            observed_energy_per_m=new_level,
            prediction=Prediction(
                new_level,
                confirm_at_least=midpoint if rising else None,
                confirm_at_most=None if rising else midpoint,
            ),
            alternative="кратковременный штраф, поворот или шум, а не новый режим грунта",
            evidence=evidence,
            detection_id=detection_id,
        )
        # активную гипотезу о дорогом участке той же корзины заменяет более свежая
        for other in self._items:
            if other.bucket == bucket and other.status in (HypothesisStatus.PROPOSED, HypothesisStatus.TESTING):
                other.status = HypothesisStatus.DEFERRED
        self._items.insert(0, item)  # проверка изменения важнее старых гипотез
        return item

    def start_experiment(self, item: Hypothesis, estimator: TerrainEstimator) -> str:
        item.status = HypothesisStatus.TESTING
        item.attempts += 1
        item.started_after_sequence = estimator.revision
        self._experiments += 1
        experiment_id = f"experiment-{self._experiments}"
        item.experiment_ids.append(experiment_id)
        return experiment_id

    def evaluate(self, item: Hypothesis, estimator: TerrainEstimator) -> HypothesisStatus | None:
        """Сравнивает новое независимое измерение с прогнозом; None — измерений пока недостаточно.

        Измерение, неотличимое от порога в пределах своей неопределённости, тоже считается
        недостаточным: решение не принимается по шуму.
        """
        measurement = estimator.energy_per_m_since(item.bucket, item.started_after_sequence)
        if measurement is None or measurement[1] < self._min_verify_distance:
            return None
        value, distance = measurement
        std = estimator.residual_std / max(distance, 1e-6) + 0.05
        item.measured_energy_per_m, item.measured_distance_m, item.measurement_std = value, distance, std
        threshold = self.confirm_threshold(item)
        if abs(value - threshold) < self._ambiguity_sigmas * std and item.attempts < self._max_attempts:
            return None
        if item.prediction.confirm_at_least is not None:
            confirmed = value >= item.prediction.confirm_at_least
        else:
            confirmed = value <= item.prediction.confirm_at_most
        item.status = HypothesisStatus.CONFIRMED if confirmed else HypothesisStatus.REFUTED
        return item.status

    def give_up_or_retry(self, item: Hypothesis) -> HypothesisStatus:
        """Проверка не дала решающего измерения: после лимита попыток — недостаточно данных."""
        item.status = (
            HypothesisStatus.UNVERIFIED if item.attempts >= self._max_attempts
            else HypothesisStatus.PROPOSED
        )
        return item.status

    def defer(self, item: Hypothesis) -> None:
        item.status = HypothesisStatus.DEFERRED

    def reopen_deferred(self) -> None:
        for item in self._items:
            if item.status is HypothesisStatus.DEFERRED:
                item.status = HypothesisStatus.PROPOSED


def describe_measurement(item: Hypothesis) -> str | None:
    """Текст измерения проверки; None — независимого измерения нет."""
    if item.measured_energy_per_m is None:
        return None
    std = item.measurement_std if item.measurement_std is not None and math.isfinite(item.measurement_std) else 0.0
    return f"{item.measured_energy_per_m:.2f} ± {std:.2f} ед./м на {item.measured_distance_m:.2f} м"
