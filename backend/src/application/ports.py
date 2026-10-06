"""Порты: границы ядра с внешним миром. Реализации — ROS, HTTP/LLM и файловые адаптеры или тестовые двойники."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from domain.grid import OccupancyGrid
from domain.journal import JournalDraft, JournalEntry
from domain.observations import Observation
from domain.subgoals import PlanningContext, Subgoal


class ObservationSource(Protocol):
    def latest(self) -> Observation | None:
        """Последнее наблюдение (поза в мировых координатах, батарея, сигнал) или None."""


class VelocityDrive(Protocol):
    """Единственный владелец команд скорости. Реализация ROS преобразует в TwistStamped."""

    def command(self, linear_mps: float, angular_radps: float) -> None: ...

    def stop(self) -> None:
        """Должна фактически остановить робота; вызывается идемпотентно."""


@dataclass(frozen=True)
class JudgeReply:
    success: bool
    message: str = ""


class JudgeClient(Protocol):
    def collect(self) -> JudgeReply: ...

    def finish(self) -> JudgeReply: ...


class SimulationControl(Protocol):
    """Согласованный сброс робота, судьи, батареи, сигнала и часов перед новым прогоном."""

    def reset(self, scenario: str, seed: int) -> None:
        """Блокирует до готовности; исключение — отказ сброса."""


class MapSource(Protocol):
    def load(self) -> OccupancyGrid | None:
        """None — карта ещё не загружена."""


class EnvironmentStatus(Protocol):
    judge_mode: str

    def ros_connected(self) -> bool: ...

    def llm_available(self) -> bool: ...


class Planner(Protocol):
    """Выбор подцели. Возвращает намерение, не скорости."""

    def propose(self, context: PlanningContext, is_cancelled: "CancelCheck") -> Subgoal:
        """Исключение PlannerError — планировщик не смог ответить."""


class CancelCheck(Protocol):
    def __call__(self) -> bool: ...


class PlannerError(Exception):
    """Планировщик не вернул допустимый ответ (таймаут, JSON, отказ API, нет ключа)."""


class JournalStore(Protocol):
    def append(self, run_id: str, draft: JournalDraft) -> JournalEntry: ...

    def read(self, run_id: str, after_sequence: int, limit: int) -> tuple[list[JournalEntry], bool]:
        """Записи с sequence > after_sequence по возрастанию и признак has_more."""

    def tail(self, run_id: str, count: int) -> list[JournalEntry]: ...


class Clock(Protocol):
    def monotonic_s(self) -> float: ...
