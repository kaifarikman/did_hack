"""Разрешённые события судьи. Агент видит факт воздействия, но не скрытые границы и расписание."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from domain.geometry import Point
from domain.observations import DEFAULT_ROBOT_ID


class EventKind(str, Enum):
    COLLISION = "collision"
    FALSE_COLLECT = "false_collect"
    HAZARD_HIT = "hazard_hit"
    SAMPLE_COLLECTED = "sample_collected"

    @property
    def is_penalty(self) -> bool:
        return self is not EventKind.SAMPLE_COLLECTED


@dataclass(frozen=True)
class PublicEvent:
    """`sequence` уникален внутри поколения прогона; повтор того же номера — дубликат."""

    sequence: int
    kind: EventKind
    simulation_time_s: float | None
    robot_id: str = DEFAULT_ROBOT_ID
    generation: int | None = None
    position: Point | None = None  # поза робота в момент события по наблюдениям адаптера
    battery_after: float | None = None
