"""Гипотеза о стоимости грунта: ожидание → проверочный проезд → измерение → вывод."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from domain.energy import TerrainEstimator
from domain.geometry import Point


class HypothesisStatus(str, Enum):
    PROPOSED = "proposed"
    TESTING = "testing"
    CONFIRMED = "confirmed"
    REFUTED = "refuted"
    DEFERRED = "deferred"
    UNVERIFIED = "unverified"


@dataclass
class Hypothesis:
    hypothesis_id: str
    bucket: tuple[int, int]
    center: Point
    baseline_energy_per_m: float
    observed_energy_per_m: float
    expected_energy_per_m: float
    status: HypothesisStatus = HypothesisStatus.PROPOSED
    started_after_sequence: int = 0
    attempts: int = 0
    measured_energy_per_m: float | None = None


class HypothesisBook:
    def __init__(
        self, elevated_ratio: float = 1.5, min_confidence: float = 0.1,
        min_verify_distance_m: float = 0.3, max_attempts: int = 2, confirm_ratio: float = 1.3,
    ) -> None:
        self._elevated_ratio = elevated_ratio
        self._min_confidence = min_confidence
        self._min_verify_distance = min_verify_distance_m
        self._max_attempts = max_attempts
        self._confirm_ratio = confirm_ratio
        self._items: list[Hypothesis] = []

    @property
    def items(self) -> tuple[Hypothesis, ...]:
        return tuple(self._items)

    def active(self) -> Hypothesis | None:
        for item in self._items:
            if item.status in (HypothesisStatus.PROPOSED, HypothesisStatus.TESTING):
                return item
        return None

    def propose(self, estimator: TerrainEstimator) -> Hypothesis | None:
        """Новая гипотеза: корзина заметно дороже базовой линии остальных измеренных."""
        baseline = estimator.baseline_energy_per_m()
        if baseline is None or self.active() is not None:
            return None
        known = {item.bucket for item in self._items}
        for bucket in estimator.measured_buckets():
            estimate = estimator.estimate_for_bucket(bucket)
            if bucket in known or estimate.confidence < self._min_confidence:
                continue
            if estimate.energy_per_m >= self._elevated_ratio * baseline:
                item = Hypothesis(
                    hypothesis_id=f"hypothesis-{len(self._items) + 1}",
                    bucket=bucket,
                    center=estimator.bucket_center(bucket),
                    baseline_energy_per_m=baseline,
                    observed_energy_per_m=estimate.energy_per_m,
                    expected_energy_per_m=estimate.energy_per_m,
                )
                self._items.append(item)
                return item
        return None

    def confirm_threshold(self, item: Hypothesis) -> float:
        return self._confirm_ratio * item.baseline_energy_per_m

    def start_experiment(self, item: Hypothesis, estimator: TerrainEstimator) -> None:
        item.status = HypothesisStatus.TESTING
        item.attempts += 1
        item.started_after_sequence = estimator.revision

    def evaluate(self, item: Hypothesis, estimator: TerrainEstimator) -> HypothesisStatus | None:
        """Сравнивает новое измерение с ожиданием; None — измерений пока недостаточно."""
        measurement = estimator.energy_per_m_since(item.bucket, item.started_after_sequence)
        if measurement is None or measurement[1] < self._min_verify_distance:
            return None
        item.measured_energy_per_m = measurement[0]
        confirmed = measurement[0] >= self._confirm_ratio * item.baseline_energy_per_m
        item.status = HypothesisStatus.CONFIRMED if confirmed else HypothesisStatus.REFUTED
        return item.status

    def give_up_or_retry(self, item: Hypothesis) -> HypothesisStatus:
        """Проверка не дала измерения: после лимита попыток гипотеза остаётся непроверенной."""
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
