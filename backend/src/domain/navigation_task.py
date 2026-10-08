"""Пользовательская задача «дойти до точки и вернуться»: цель, фазы и факт достижения.

Достижение — наблюдаемая поза в пределах допуска от цели, а не исчерпание путевых точек.
Фаза следует статусу миссии; при запросе Stop последняя фаза сохраняется до подтверждения.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from domain.geometry import Point, distance_m


class TaskType(str, Enum):
    RESEARCH = "research"
    NAVIGATION = "navigation"


class NavigationPhase(str, Enum):
    PENDING = "pending"
    MOVING_TO_TARGET = "moving_to_target"
    RETURNING = "returning"
    FINISHED = "finished"
    STOPPED = "stopped"
    FAILED = "failed"


@dataclass(frozen=True)
class NavigationTarget:
    """Точка в мировой системе карты и версия карты, по которой её выбрал пользователь."""

    point: Point
    map_id: str


@dataclass(frozen=True)
class NavigationView:
    target: NavigationTarget
    phase: NavigationPhase
    target_reached: bool
    target_reached_at_s: float | None
    arrival_tolerance_m: float

    def is_reached_by(self, position: Point) -> bool:
        return distance_m(position, self.target.point) <= self.arrival_tolerance_m


class NavigationTask:
    """Состояние задачи; изменяется только владельцем-миссией под её блокировкой."""

    def __init__(self, target: NavigationTarget, arrival_tolerance_m: float) -> None:
        if arrival_tolerance_m <= 0:
            raise ValueError("допуск прибытия должен быть положительным")
        self.target = target
        self.arrival_tolerance_m = arrival_tolerance_m
        self.phase = NavigationPhase.PENDING
        self.target_reached = False
        self.target_reached_at_s: float | None = None

    def is_reached_by(self, position: Point) -> bool:
        return distance_m(position, self.target.point) <= self.arrival_tolerance_m

    def mark_reached(self, simulation_time_s: float | None) -> bool:
        """Фиксирует первое достижение; повтор не меняет время. True — состояние изменилось."""
        if self.target_reached:
            return False
        self.target_reached = True
        self.target_reached_at_s = simulation_time_s
        return True

    def enter(self, phase: NavigationPhase | None) -> None:
        if phase is not None:
            self.phase = phase

    def view(self) -> NavigationView:
        return NavigationView(self.target, self.phase, self.target_reached, self.target_reached_at_s,
                              self.arrival_tolerance_m)
