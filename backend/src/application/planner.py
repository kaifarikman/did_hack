"""Планировщик с резервом: основной (LLM) при сбое заменяется алгоритмическим."""
from __future__ import annotations

from dataclasses import dataclass

from application.ports import CancelCheck, Planner, PlannerError
from domain.plans import MissionPlan, single_step_plan
from domain.policy import decide_subgoal
from domain.settings import MissionSettings
from domain.subgoals import PlanningContext, Subgoal


class FallbackPlanner:
    def __init__(self, settings: MissionSettings) -> None:
        self._settings = settings

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> MissionPlan:
        goal = decide_subgoal(context, self._settings)
        return single_step_plan(context, goal, f"Алгоритмический резерв: {goal.reason}")


@dataclass
class ResilientPlanner:
    """Явно видимый fallback: причина сбоя пишется в `last_fallback_reason` и в план."""

    primary: Planner | None
    fallback: Planner
    last_fallback_reason: str | None = None

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> MissionPlan:
        if self.primary is None:
            self.last_fallback_reason = "LLM не настроена"
            return self.fallback.propose(context, is_cancelled)
        try:
            plan = self.primary.propose(context, is_cancelled)
            self.last_fallback_reason = None
            return plan
        except PlannerError as error:
            self.last_fallback_reason = str(error)
            plan = self.fallback.propose(context, is_cancelled)
            step = plan.steps[0].goal
            goal = Subgoal(step.kind, step.target, f"{step.reason} (fallback: {error})", "fallback")
            return single_step_plan(context, goal, plan.rationale, fallback_reason=str(error))
