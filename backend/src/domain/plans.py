"""План миссии: короткий список подцелей с предпосылками, свидетельствами и условиями пересмотра.

План — намерение, а не команды скорости. Каждый шаг перед исполнением заново проверяет
алгоритм (достижимость, энергия туда-обратно с резервом, лимиты сбора). План привязан к прогону
и версии модели среды: ответ, построенный по устаревшей модели, не исполняется.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from domain.subgoals import PlanningContext, Subgoal

MAX_PLAN_STEPS = 4


class StepStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    DONE = "done"
    REJECTED = "rejected"  # исполнитель отклонил шаг при проверке
    DROPPED = "dropped"  # план пересмотрен до этого шага


@dataclass(frozen=True)
class PlanStep:
    goal: Subgoal
    evidence: tuple[str, ...] = ()  # ссылки на журнал/измерения, на которые опирается шаг
    revise_if: str | None = None  # условие пересмотра, сформулированное планировщиком


@dataclass(frozen=True)
class MissionPlan:
    plan_id: str
    run_id: str
    model_epoch: int  # версия существенных изменений модели, по которой построен план
    map_revision: int
    steps: tuple[PlanStep, ...]
    rationale: str
    premises: tuple[str, ...] = ()
    source: str = "fallback"  # llm | fallback
    fallback_reason: str | None = None


@dataclass
class PlanProgress:
    """Исполнение плана: статус каждого шага и причина пересмотра."""

    plan: MissionPlan
    statuses: list[StepStatus] = field(default_factory=list)
    revision_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.statuses:
            self.statuses = [StepStatus.PENDING] * len(self.plan.steps)

    def next_index(self) -> int | None:
        for index, status in enumerate(self.statuses):
            if status is StepStatus.PENDING:
                return index
        return None

    def active_index(self) -> int | None:
        return next((index for index, status in enumerate(self.statuses) if status is StepStatus.ACTIVE), None)

    def mark(self, index: int, status: StepStatus) -> None:
        self.statuses[index] = status

    def drop_rest(self, reason: str) -> None:
        self.revision_reason = reason
        self.statuses = [
            StepStatus.DROPPED if status in (StepStatus.PENDING, StepStatus.ACTIVE) else status
            for status in self.statuses
        ]

    @property
    def finished(self) -> bool:
        return all(status not in (StepStatus.PENDING, StepStatus.ACTIVE) for status in self.statuses)


def single_step_plan(context: PlanningContext, goal: Subgoal, rationale: str, fallback_reason: str | None = None) -> MissionPlan:
    """План из одного шага: алгоритмический резерв или терминальный возврат."""
    return MissionPlan(
        plan_id=context.plan_id, run_id=context.run_id, model_epoch=context.model_epoch,
        map_revision=context.map_revision, steps=(PlanStep(goal),), rationale=rationale,
        source=goal.source, fallback_reason=fallback_reason,
    )
