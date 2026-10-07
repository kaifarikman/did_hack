"""Обнаружение изменения стоимости грунта по остаткам прогноза (двусторонний CUSUM по корзине).

Каждый новый отрезок сравнивается с прогнозом модели **до** его учёта. Повороты и простой уже
вычтены моделью, штрафные отрезки в неё не попадают, отрезок относится к корзине только при
достаточной доле пути в ней. Тревога требует накопленного отклонения и минимального пути в
«новом» режиме, а прежний уровень должен быть установлен измерениями, а не prior.
Пороги выбраны `scripts/analysis/adaptation.py` на подменной среде (k=0.75, h=5, два проезда);
это провизорная калибровка до публичных записей A.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from domain.energy import Bucket, SegmentRecord, TerrainEstimate


@dataclass(frozen=True)
class TerrainShift:
    bucket: Bucket
    rising: bool
    old_level: float
    new_level: float
    first_sequence: int  # первый отрезок нового режима
    evidence: tuple[int, ...]
    statistic: float


@dataclass
class _Run:
    in_control: list[float] = field(default_factory=list)  # остатки вне тревожных серий: разброс самой ячейки
    upper: float = 0.0
    lower: float = 0.0
    up_sequences: list[int] = field(default_factory=list)
    down_sequences: list[int] = field(default_factory=list)
    up_residual: float = 0.0
    down_residual: float = 0.0
    up_distance: float = 0.0
    down_distance: float = 0.0
    last_sequence: int = -10
    passes: int = 0  # номер проезда ячейки: между проездами были отрезки в других ячейках
    up_passes: set[int] = field(default_factory=set)
    down_passes: set[int] = field(default_factory=set)


class TerrainChangeDetector:
    def __init__(
        self, drift: float = 0.75, threshold: float = 5.0, min_run_distance_m: float = 0.6,
        min_share: float = 0.5, min_established_m: float = 0.6, min_relative_change: float = 0.3,
        noise_floor: float = 0.05, min_in_control: int = 0, min_passes: int = 2,
    ) -> None:
        self._min_in_control = min_in_control
        self._min_passes = min_passes
        self._drift = drift
        self._threshold = threshold
        self._min_run = min_run_distance_m
        self._min_share = min_share
        self._min_established = min_established_m
        self._min_relative = min_relative_change
        self._noise_floor = noise_floor
        self._runs: dict[Bucket, _Run] = {}

    def reset(self, bucket: Bucket) -> None:
        self._runs.pop(bucket, None)

    def update(
        self, record: SegmentRecord, predicted_drop: float, residual_std: float, before: TerrainEstimate,
    ) -> TerrainShift | None:
        bucket, share = record.dominant()
        if share < self._min_share or before.distance_m < self._min_established:
            return None
        inside = record.distance_m * share
        residual = record.battery_drop - predicted_drop
        run = self._runs.setdefault(bucket, _Run())
        if record.sequence - run.last_sequence > 1:
            run.passes += 1
        run.last_sequence = record.sequence
        # ячейка, частично покрывающая зону, неоднородна: её собственный разброс больше общего
        own = (sum(value * value for value in run.in_control) / len(run.in_control)) ** 0.5 if len(run.in_control) >= 3 else 0.0
        sigma = max(residual_std, own, self._noise_floor)
        score = residual / sigma
        if run.upper == 0.0 and run.lower == 0.0 and abs(score) < self._drift + 1.0:
            run.in_control = (run.in_control + [residual])[-20:]
        run.upper = max(0.0, run.upper + score - self._drift)
        run.lower = max(0.0, run.lower - score - self._drift)
        if run.upper == 0.0:
            run.up_sequences, run.up_residual, run.up_distance, run.up_passes = [], 0.0, 0.0, set()
        else:
            run.up_sequences.append(record.sequence)
            run.up_residual += residual
            run.up_distance += inside
            run.up_passes.add(run.passes)
        if run.lower == 0.0:
            run.down_sequences, run.down_residual, run.down_distance, run.down_passes = [], 0.0, 0.0, set()
        else:
            run.down_sequences.append(record.sequence)
            run.down_residual += residual
            run.down_distance += inside
            run.down_passes.add(run.passes)
        if len(run.in_control) < self._min_in_control:
            return None  # разброс самой ячейки ещё не известен: смешанная ячейка не отличима от изменения
        for rising in (True, False):
            statistic = run.upper if rising else run.lower
            distance = run.up_distance if rising else run.down_distance
            passes = len(run.up_passes if rising else run.down_passes)
            if statistic < self._threshold or distance < self._min_run or passes < self._min_passes:
                continue  # одно прохождение может быть артефактом смешанной ячейки
            sequences = run.up_sequences if rising else run.down_sequences
            residual_sum = run.up_residual if rising else run.down_residual
            new_level = max(0.0, before.energy_per_m + residual_sum / distance)
            if abs(new_level - before.energy_per_m) < self._min_relative * max(before.energy_per_m, 0.1):
                continue
            self.reset(bucket)
            return TerrainShift(bucket, rising, before.energy_per_m, new_level, sequences[0],
                                tuple(sequences), statistic)
        return None
