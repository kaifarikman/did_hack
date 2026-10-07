"""Исполнение плана миссии: запрос плана в фоне, лимиты запросов, отбрасывание устаревших
ответов, проверка каждого шага и алгоритмический резерв.

Тик никогда не ждёт планировщик. Ответ применяется, только если он относится к текущему
прогону и к текущей версии существенных изменений модели (`epoch`). Шаг исполняется только
после проверки алгоритмом; отклонённый шаг пропускается, исчерпанный план запрашивается заново.
"""
from __future__ import annotations

from concurrent.futures import Executor, Future
from dataclasses import dataclass, replace
from typing import Callable

from application.ports import CancelCheck, Planner, PlannerError
from application.validation import GoalVerdict
from domain.journal import JournalKind
from domain.plans import MissionPlan, PlanProgress, PlanStep, StepStatus, single_step_plan
from domain.policy import decide_subgoal
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, PlanningContext, Subgoal

Verdict = Callable[[Subgoal], GoalVerdict]
Log = Callable[..., None]


@dataclass(frozen=True)
class Waiting:
    """Ответа планировщика ещё нет: тик продолжает контроль Stop и наблюдений."""


@dataclass(frozen=True)
class Chosen:
    goal: Subgoal
    verdict: GoalVerdict


@dataclass(frozen=True)
class NothingValid:
    """Ни шаг плана, ни резервная цель, ни возврат не допустимы."""


class PlanExecutor:
    def __init__(
        self, planner: Planner, settings: MissionSettings, executor: Executor, log: Log,
        now_s: Callable[[], float], is_cancelled: CancelCheck, rate_limited: bool = True,
    ) -> None:
        self._planner = planner
        self._rate_limited = rate_limited  # лимиты нужны для удалённой LLM; локальный резерв не ограничивается
        self._settings = settings
        self._executor = executor
        self._log = log
        self._now_s = now_s
        self._is_cancelled = is_cancelled
        self._pending: Future[MissionPlan] | None = None
        self._pending_context: PlanningContext | None = None
        self._progress: PlanProgress | None = None
        self._epoch = 0
        self._plans = 0
        self.requests = 0
        self._last_request_s: float | None = None

    # ------------------------------------------------------------ состояние

    @property
    def epoch(self) -> int:
        return self._epoch

    @property
    def progress(self) -> PlanProgress | None:
        return self._progress

    @property
    def waiting(self) -> bool:
        return self._pending is not None

    def next_plan_id(self) -> str:
        return f"plan-{self._plans + 1}"

    def invalidate(self, reason: str, detection_id: str | None = None) -> None:
        """Существенное изменение модели: оставшиеся шаги и ожидаемый ответ устарели."""
        self._epoch += 1
        progress = self._progress
        if progress is not None and not progress.finished:
            progress.drop_rest(reason)
            self._log(JournalKind.DECISION, "План пересмотрен", f"{progress.plan.plan_id}: {reason}.",
                      plan_id=progress.plan.plan_id, detection_id=detection_id)

    def cancel(self) -> None:
        self._pending = None
        self._pending_context = None

    def step_finished(self, success: bool) -> None:
        progress = self._progress
        if progress is None:
            return
        index = progress.active_index()
        if index is not None:
            progress.mark(index, StepStatus.DONE if success else StepStatus.REJECTED)

    # ------------------------------------------------------------ решение

    def poll(self, build_context: Callable[[str, int], PlanningContext], verdict: Verdict) -> Waiting | Chosen | NothingValid:
        chosen = self._next_from_plan(verdict)
        if chosen is not None:
            return chosen
        if self._pending is None:
            if self._too_soon():
                return Waiting()  # не чаще одного запроса в min_planner_interval_s
            context = build_context(self.next_plan_id(), self._epoch)
            if self._rate_limited and self.requests >= self._settings.max_planner_requests:
                plan = self._fallback_plan(context, "исчерпан лимит запросов к планировщику за прогон")
                return self._adopt_and_choose(plan, context, verdict)
            self._pending, self._pending_context = self._executor.submit(self._propose, context), context
            self.requests += 1
            self._last_request_s = self._now_s()
        if not self._pending.done():
            return Waiting()
        plan, context = self._pending.result(), self._pending_context
        self.cancel()
        if self._is_cancelled():
            return Waiting()  # ответ после Stop не исполняется
        if plan.run_id != context.run_id or plan.model_epoch != self._epoch:
            self._log(JournalKind.DECISION, "План отброшен как устаревший",
                      f"{plan.plan_id} построен по версии модели {plan.model_epoch}, текущая {self._epoch}; "
                      "запрашивается новый план.", plan_id=plan.plan_id)
            return Waiting()
        return self._adopt_and_choose(plan, context, verdict)

    def _too_soon(self) -> bool:
        if not self._rate_limited or self.requests >= self._settings.max_planner_requests:
            return False  # дальше работает только резерв, ждать нечего
        last = self._last_request_s
        return last is not None and self._now_s() - last < self._settings.min_planner_interval_s

    def _propose(self, context: PlanningContext) -> MissionPlan:
        try:
            plan = self._planner.propose(context, self._is_cancelled)
        except PlannerError as error:
            return self._fallback_plan(context, str(error))
        return replace(plan, plan_id=context.plan_id, run_id=context.run_id, model_epoch=context.model_epoch,
                       map_revision=context.map_revision, steps=plan.steps[: self._settings.max_plan_steps])

    def _fallback_plan(self, context: PlanningContext, reason: str) -> MissionPlan:
        goal = decide_subgoal(context, self._settings)
        goal = Subgoal(goal.kind, goal.target, f"{goal.reason} (fallback: {reason})", "fallback")
        return single_step_plan(context, goal, f"Алгоритмический резерв: {goal.reason}", fallback_reason=reason)

    def _adopt_and_choose(self, plan: MissionPlan, context: PlanningContext, verdict: Verdict) -> Chosen | NothingValid:
        self._plans += 1
        steps = tuple(
            PlanStep(replace(step.goal, plan_id=plan.plan_id), step.evidence, step.revise_if) for step in plan.steps
        )
        plan = replace(plan, steps=steps)
        self._progress = PlanProgress(plan)
        summary = "; ".join(
            f"{index + 1}) {step.goal.kind.value}"
            + (f" ({step.goal.target.x_m:.2f}, {step.goal.target.y_m:.2f})" if step.goal.target else "")
            for index, step in enumerate(plan.steps)
        )
        evidence = tuple(dict.fromkeys(ref for step in plan.steps for ref in step.evidence))
        self._log(
            JournalKind.DECISION, "План получен",
            f"{plan.plan_id} от {plan.source}: {summary}. Обоснование: {plan.rationale}"
            + (f" Предпосылки: {'; '.join(plan.premises)}." if plan.premises else "")
            + (f" Резерв: {plan.fallback_reason}." if plan.fallback_reason else ""),
            plan_id=plan.plan_id, evidence=evidence,
        )
        chosen = self._next_from_plan(verdict)
        if chosen is not None:
            return chosen
        return self._alternatives(context, verdict, plan.plan_id)

    def _next_from_plan(self, verdict: Verdict) -> Chosen | None:
        progress = self._progress
        if progress is None:
            return None
        while (index := progress.next_index()) is not None:
            goal = progress.plan.steps[index].goal
            result = verdict(goal)
            if result.accepted:
                progress.mark(index, StepStatus.ACTIVE)
                return Chosen(goal, result)
            progress.mark(index, StepStatus.REJECTED)
            self._log(JournalKind.DECISION, "Подцель отклонена исполнителем",
                      f"Шаг {index + 1} плана {progress.plan.plan_id}, {goal.kind.value}: {result.reason}. "
                      f"Источник: {goal.source}.", plan_id=progress.plan.plan_id)
        return None

    def _alternatives(self, context: PlanningContext, verdict: Verdict, plan_id: str) -> Chosen | NothingValid:
        """Все шаги плана отклонены: алгоритмические цели, затем возврат."""
        approaching = (context.best_signal or 0) >= self._settings.approach_signal_threshold
        options = [
            Subgoal(GoalKind.APPROACH, candidate.point, "Резервная уточняющая проба после отказа исполнителя.", plan_id=plan_id)
            for candidate in context.refine_candidates
        ] + [
            Subgoal(GoalKind.APPROACH if approaching else GoalKind.EXPLORE, candidate.point,
                    "Резервная цель после отказа исполнителя.", plan_id=plan_id)
            for candidate in context.candidates
        ] + [Subgoal(GoalKind.RETURN, context.base, "Возврат: другие цели недопустимы.", plan_id=plan_id)]
        for goal in options:
            result = verdict(goal)
            if result.accepted:
                return Chosen(goal, result)
            self._log(JournalKind.DECISION, "Подцель отклонена исполнителем",
                      f"{goal.kind.value}: {result.reason}. Источник: {goal.source}.", plan_id=plan_id)
        return NothingValid()

