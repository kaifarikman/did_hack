"""Наблюдение робота в единицах контракта. Отсутствующее измерение — None, не ноль."""
from __future__ import annotations

from dataclasses import dataclass

from domain.geometry import Pose


@dataclass(frozen=True)
class Observation:
    simulation_time_s: float | None
    pose: Pose | None
    battery_remaining: float | None
    sample_signal: float | None
    received_monotonic_s: float
    penalty_recent: bool = False  # судья сообщил штраф/столкновение: расход не чистая стоимость грунта
