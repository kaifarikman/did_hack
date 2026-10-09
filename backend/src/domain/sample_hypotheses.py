"""A bounded, pre-registered signal forecast, evaluated only on new public samples."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

from domain.geometry import Point, distance_m
from domain.observations import LocalizationStatus, Observation

SIGNAL_TOLERANCE = 0.10
SAMPLE_MAX_AGE_S = 0.5
MEASUREMENT_RADIUS_M = 0.30
MIN_MEASUREMENTS = 3


def sample_time(observation: Observation, monotonic_s: float) -> float | None:
    age, moment, signal = observation.sample_signal_age_s, observation.sample_signal_received_monotonic_s, observation.sample_signal
    if (age is None or moment is None or signal is None
            or not all(math.isfinite(value) for value in (age, moment, signal))
            or not 0 <= age <= SAMPLE_MAX_AGE_S or not 0 <= signal <= 1
            or not 0 <= monotonic_s - moment <= SAMPLE_MAX_AGE_S
            or observation.pose is None or observation.localization is not LocalizationStatus.OK):
        return None
    if observation.freshness is not None and any(
        source.fresh is not True for source in (observation.freshness.odom, observation.freshness.clock)
    ):
        return None
    return moment


@dataclass
class SampleHypothesis:
    hypothesis_id: str
    center: Point
    expected_signal: float
    baseline_signal: float
    start: Observation
    started_sample_time: float
    started_monotonic_s: float
    status: str = "testing"
    measured_signal: float | None = None
    conclusion: str | None = None
    measurements: list[tuple[float, float, int | None]] = field(default_factory=list)

    @property
    def experiment_id(self) -> str:
        return f"sample-experiment-{self.hypothesis_id.rsplit('-', 1)[-1]}"

    @property
    def lower(self) -> float:
        return max(0, self.expected_signal - SIGNAL_TOLERANCE)

    @property
    def upper(self) -> float:
        return min(1, self.expected_signal + SIGNAL_TOLERANCE)

    @property
    def prediction(self) -> str:
        return (f"Сигнал в целевой области ≈ {self.expected_signal:.3f}; "
                f"медиана новых показаний в [{self.lower:.3f}, {self.upper:.3f}].")

    @property
    def action(self) -> str:
        return f"Доехать к ({self.center.x_m:.2f}, {self.center.y_m:.2f}) и измерить сигнал образцов."

    @property
    def measurement(self) -> str | None:
        if self.measured_signal is None:
            return None
        return f"Медиана сигнала {self.measured_signal:.3f}, новых показаний: {len(self.measurements)}."

    def observe(self, observation: Observation, sensor_usable: bool, monotonic_s: float) -> None:
        moment = sample_time(observation, monotonic_s)
        if (self.status != "testing" or not sensor_usable or moment is None
                or observation.robot_id != self.start.robot_id or observation.generation != self.start.generation
                or moment <= self.started_sample_time + 1e-6
                or moment <= self.started_monotonic_s + 1e-6
                or (self.start.sequence is not None and
                    (observation.sequence is None or observation.sequence <= self.start.sequence))
                or distance_m(observation.pose.point, self.center) > MEASUREMENT_RADIUS_M
                or distance_m(observation.pose.point, self.start.pose.point) < 0.15
                or (self.measurements and (moment <= self.measurements[-1][0] + 1e-6
                    or observation.sequence <= self.measurements[-1][2]))):
            return
        self.measurements.append((moment, observation.sample_signal, observation.sequence))
        del self.measurements[:-15]

    def finish(self, reason: str | None = None) -> None:
        if self.status != "testing":
            return
        if reason is not None or len(self.measurements) < MIN_MEASUREMENTS:
            self.status = "unverified"
            self.conclusion = f"Недостаточно независимых данных: {reason or 'меньше трёх новых показаний у цели'}."
            return
        self.measured_signal = median(value for _, value, _ in self.measurements)
        # Noise close to the acceptance boundary cannot decide a hypothesis.
        if min(abs(self.measured_signal - self.lower), abs(self.measured_signal - self.upper)) < 0.02:
            self.status = "unverified"
            self.conclusion = "Недостаточно данных: сигнал близок к границе прогнозного интервала."
            return
        self.status = "confirmed" if self.lower <= self.measured_signal <= self.upper else "refuted"
        self.conclusion = ("Подтверждено: прогноз сигнала согласуется с измерением." if self.status == "confirmed"
                           else "Опровергнуто: прогноз сигнала не согласуется с новым измерением; локальная модель поиска уточняется.")
