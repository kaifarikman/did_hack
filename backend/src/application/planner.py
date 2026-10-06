"""Планировщик с резервом: основной (LLM) при сбое заменяется алгоритмическим."""
from __future__ import annotations

from dataclasses import dataclass

from application.ports import CancelCheck, Planner, PlannerError
from domain.policy import decide_subgoal
from domain.settings import MissionSettings
from domain.subgoals import PlanningContext, Subgoal


class FallbackPlanner:
    def __init__(self, settings: MissionSettings) -> None:
        self._settings = settings

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> Subgoal:
        return decide_subgoal(context, self._settings)


@dataclass
class ResilientPlanner:
    """Явно видимый fallback: причина сбоя пишется в `last_fallback_reason` и в reason подцели."""

    primary: Planner | None
    fallback: Planner
    last_fallback_reason: str | None = None

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> Subgoal:
        if self.primary is None:
            self.last_fallback_reason = "LLM не настроена"
            return self.fallback.propose(context, is_cancelled)
        try:
            goal = self.primary.propose(context, is_cancelled)
            self.last_fallback_reason = None
            return goal
        except PlannerError as error:
            self.last_fallback_reason = str(error)
            fallback_goal = self.fallback.propose(context, is_cancelled)
            return Subgoal(
                fallback_goal.kind, fallback_goal.target,
                f"{fallback_goal.reason} (fallback: {error})", "fallback",
            )
