"""Наблюдение робота в единицах контракта. Отсутствующее измерение — None, не ноль.

Контракт F02: каждое наблюдение адресовано роботу и поколению прогона, несёт время и
свежесть источников. Отсутствие sample-сигнала отличается от потери позы или батареи.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from domain.geometry import Point, Pose

DEFAULT_ROBOT_ID = "robot_1"


@dataclass(frozen=True)
class SourceFreshness:
    """Возраст и пороговая свежесть одного измерительного источника."""

    age_s: float | None = None
    fresh: bool | None = None


@dataclass(frozen=True)
class ObservationFreshness:
    odom: SourceFreshness = SourceFreshness()
    scan: SourceFreshness = SourceFreshness()
    battery: SourceFreshness = SourceFreshness()
    clock: SourceFreshness = SourceFreshness()


class LocalizationStatus(str, Enum):
    """Качество позы. `lost` останавливает движение; `degraded` требует запаса при возврате."""

    OK = "ok"
    DEGRADED = "degraded"
    LOST = "lost"


@dataclass(frozen=True)
class Observation:
    simulation_time_s: float | None
    pose: Pose | None
    battery_remaining: float | None
    sample_signal: float | None
    received_monotonic_s: float  # время самого старого критического источника
    penalty_recent: bool = False  # устаревший флаг MVP: штраф недавно; новый код читает события
    robot_id: str = DEFAULT_ROBOT_ID
    sequence: int | None = None  # номер измерения адаптера, растёт внутри поколения
    generation: int | None = None  # поколение прогона из ResetAck; None — адаптер без поколений
    sample_signal_age_s: float | None = None  # возраст последнего сообщения датчика образцов
    localization: LocalizationStatus = LocalizationStatus.OK
    localization_error_m: float | None = None  # оценка ошибки позы, если её даёт источник
    freshness: ObservationFreshness | None = None
    scan_obstacles: tuple[Point, ...] = ()  # попадания LaserScan в координатах world

    @property
    def motion_critical_missing(self) -> bool:
        """Без позы, батареи или при потере локализации двигаться нельзя."""
        return (
            self.pose is None
            or self.battery_remaining is None
            or self.localization is LocalizationStatus.LOST
        )
