"""Алгоритмический выбор подцели (fallback): правила поверх контекста планирования."""
from __future__ import annotations

from domain.settings import MissionSettings
from domain.subgoals import GoalKind, PlanningContext, Subgoal


def decide_subgoal(context: PlanningContext, settings: MissionSettings) -> Subgoal:
    if context.reserve_low:
        return Subgoal(GoalKind.RETURN, context.base, "Запас энергии на возврат на пределе.")
    if context.samples_collected >= settings.target_samples:
        return Subgoal(GoalKind.RETURN, context.base, "Целевое число образцов собрано.")
    if context.decisions_made >= settings.max_decisions:
        return Subgoal(GoalKind.RETURN, context.base, "Лимит решений исчерпан, поиск завершён.")
    if context.decisions_since_improvement >= settings.stall_decisions:
        return Subgoal(GoalKind.RETURN, context.base, "Сигнал давно не улучшался.")

    attempts_allowed = (
        context.total_collect_attempts < settings.max_collect_attempts
        and context.collect_attempts_here < 2
    )
    if (
        context.sample_signal is not None
        and context.sample_signal >= settings.collect_signal_threshold
        and attempts_allowed
    ):
        return Subgoal(
            GoalKind.COLLECT, None,
            f"Сигнал {context.sample_signal:.2f} выше порога сбора {settings.collect_signal_threshold:.2f}.",
        )
    if not context.candidates:
        return Subgoal(GoalKind.RETURN, context.base, "Нет достижимых кандидатов для поиска.")
    best = context.candidates[0]
    strong = (context.best_signal or 0.0) >= settings.approach_signal_threshold
    kind = GoalKind.APPROACH if strong else GoalKind.EXPLORE
    reason = (
        f"Прогноз сигнала {best.expected_signal:.2f}; "
        + ("уточняем направление по истории сигнала." if strong else "сигнал слабый, исследуем новые области.")
    )
    return Subgoal(kind, best.point, reason)
