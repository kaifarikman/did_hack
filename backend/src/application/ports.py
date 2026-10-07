"""Порты: границы ядра с внешним миром. Реализации — ROS, HTTP/LLM и файловые адаптеры или тестовые двойники.

Контракт F02 описан в context/full-solution/contract-f02.md. Изменение сигнатур — новая версия
CONTRACT_VERSION и обновление общих fixtures в tests/fixtures/contract.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol

from domain.events import PublicEvent
from domain.grid import OccupancyGrid
from domain.journal import JournalDraft, JournalEntry
from domain.observations import DEFAULT_ROBOT_ID, Observation
from domain.subgoals import PlanningContext, Subgoal

CONTRACT_VERSION = "2.0"


class ObservationSource(Protocol):
    def latest(self) -> Observation | None:
        """Последнее наблюдение (поза в мировых координатах, батарея, сигнал) или None."""


class EventSource(Protocol):
    def events_after(self, sequence: int) -> list[PublicEvent]:
        """Разрешённые события с номером > sequence по возрастанию; пустой список — новых нет."""


class VelocityDrive(Protocol):
    """Единственный владелец команд скорости. Реализация ROS преобразует в TwistStamped."""

    def command(self, linear_mps: float, angular_radps: float) -> None: ...

    def stop(self) -> None:
        """Должна фактически остановить робота; вызывается идемпотентно."""


class OperationOutcome(str, Enum):
    """Исход сервиса судьи. `unknown` — таймаут/обрыв: результат сверяется со счётом, не повторяется вслепую."""

    SUCCEEDED = "succeeded"
    REJECTED = "rejected"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class JudgeReply:
    success: bool
    message: str = ""
    outcome: OperationOutcome | None = None  # None в старом адаптере: выводится из success

    def __post_init__(self) -> None:
        if self.outcome is None:
            derived = OperationOutcome.SUCCEEDED if self.success else OperationOutcome.REJECTED
            object.__setattr__(self, "outcome", derived)
        elif (self.outcome is OperationOutcome.SUCCEEDED) != self.success:
            raise ValueError("success и outcome противоречат друг другу")


@dataclass(frozen=True)
class PublicScore:
    """Публичный счёт /did/score: единственный способ сверить неизвестный исход collect/finish."""

    collected: int
    finished: bool
    finish_success: bool | None = None
    simulation_time_s: float | None = None
    robot_id: str = DEFAULT_ROBOT_ID


class JudgeClient(Protocol):
    def collect(self) -> JudgeReply: ...

    def finish(self) -> JudgeReply: ...


class ScoreSource(Protocol):
    def score(self) -> PublicScore | None:
        """Последний опубликованный счёт или None, если его ещё не было."""


class MapMode(str, Enum):
    STATIC = "static"  # готовая карта turtlebot3_world
    SLAM = "slam"  # карта строится из наблюдений, вначале может отсутствовать


@dataclass(frozen=True)
class ResetRequest:
    scenario: str
    seed: int
    generation: int  # новое поколение прогона; ответы старых поколений отбрасываются
    map_mode: MapMode = MapMode.STATIC
    robot_ids: tuple[str, ...] = (DEFAULT_ROBOT_ID,)


@dataclass(frozen=True)
class ResetAck:
    """Готовность нового поколения. Адаптер подтверждает то, что фактически применено."""

    generation: int
    scenario: str
    seed: int
    map_mode: MapMode = MapMode.STATIC
    robot_ids: tuple[str, ...] = (DEFAULT_ROBOT_ID,)
    notes: tuple[str, ...] = field(default_factory=tuple)

    def matches(self, request: ResetRequest) -> bool:
        return (
            self.generation == request.generation
            and self.scenario == request.scenario
            and self.seed == request.seed
            and self.map_mode is request.map_mode
            and self.robot_ids == request.robot_ids
        )


class SimulationControl(Protocol):
    """Согласованный сброс робота, судьи, батареи, сигнала и часов перед новым прогоном."""

    def reset(self, request: ResetRequest) -> ResetAck:
        """Блокирует до готовности; исключение — отказ сброса."""


class MapSource(Protocol):
    def load(self) -> OccupancyGrid | None:
        """None — карты ещё нет (статичная не загружена или SLAM не начал). `revision` растёт при изменениях."""


class EnvironmentStatus(Protocol):
    judge_mode: str

    def ros_connected(self) -> bool: ...

    def llm_available(self) -> bool: ...

    def supported_scenarios(self) -> tuple[str, ...]:
        """Профили, которые среда действительно применяет при reset."""


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
