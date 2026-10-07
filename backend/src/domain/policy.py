"""Алгоритмический выбор подцели (fallback): правила поверх контекста планирования.

Порядок: запас возврата → все образцы профиля собраны → лимиты поиска → сбор на локальном
максимуме → уточняющие пробы при сильном сигнале → лучшая по полезности цель → возврат.
"""
from __future__ import annotations

from domain.settings import MissionSettings
from domain.subgoals import GoalKind, PlanningContext, Subgoal


def decide_subgoal(context: PlanningContext, settings: MissionSettings) -> Subgoal:
    if context.reserve_low:
        return Subgoal(GoalKind.RETURN, context.base, "Запас энергии на возврат на пределе.")
    if context.samples_collected >= context.target_samples:
        return Subgoal(GoalKind.RETURN, context.base, "Собраны все образцы, возможные в профиле.")
    if context.decisions_made >= settings.max_decisions:
        return Subgoal(GoalKind.RETURN, context.base, "Лимит решений исчерпан, поиск завершён.")
    if context.decisions_since_improvement >= settings.stall_decisions:
        return Subgoal(GoalKind.RETURN, context.base, "Сигнал давно не улучшался.")

    attempts_allowed = (
        context.total_collect_attempts < settings.max_collect_attempts
        and context.collect_attempts_here < 2
    )
    signal = context.sample_signal
    strong = signal is not None and signal >= settings.collect_signal_threshold
    if strong and attempts_allowed and (context.at_signal_peak or not context.refine_candidates):
        return Subgoal(
            GoalKind.COLLECT, None,
            f"Сигнал {signal:.2f} выше порога сбора {settings.collect_signal_threshold:.2f} "
            "и не растёт в соседних пробах.",
        )
    best = context.best_signal or 0.0
    if best >= settings.approach_signal_threshold and context.refine_candidates:
        probe = context.refine_candidates[0]
        return Subgoal(
            GoalKind.APPROACH, probe.point,
            f"Лучший сигнал {best:.2f}: проба вокруг точки максимума (прогноз {probe.expected_signal:.2f}).",
        )
    if not context.candidates:
        return Subgoal(GoalKind.RETURN, context.base, "Нет кандидатов, достижимых с обеспеченным возвратом.")
    target = context.candidates[0]
    approaching = best >= settings.approach_signal_threshold
    kind = GoalKind.APPROACH if approaching else GoalKind.EXPLORE
    energy = "" if target.energy_to is None else f" Путь ≈ {target.energy_to:.1f}, возврат оттуда ≈ {target.energy_back:.1f}."
    reason = (
        f"Прогноз сигнала {target.expected_signal:.2f}; "
        + ("уточняем направление по истории сигнала." if approaching else "сигнал слабый, исследуем новые области.")
        + energy
    )
    return Subgoal(kind, target.point, reason)
