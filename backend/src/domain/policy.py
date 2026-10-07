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

    if context.sensor_quality <= 0:
        if context.sensor_unusable_s >= settings.sensor_wait_s:
            return Subgoal(GoalKind.RETURN, context.base,
                           f"Датчик образцов непригоден {context.sensor_unusable_s:.0f} с: поиск без сигнала бесполезен.")
        nearby = min(context.candidates, key=lambda c: c.energy_to or 0.0, default=None)
        if nearby is None:
            return Subgoal(GoalKind.RETURN, context.base, "Датчик образцов непригоден, кандидатов нет.")
        return Subgoal(GoalKind.EXPLORE, nearby.point,
                       "Проверка датчика: короткий переезд, сбор вслепую не делается до восстановления.")

    noisy = context.sensor_quality < 1.0
    attempts_allowed = (
        context.total_collect_attempts < settings.max_collect_attempts
        and context.collect_attempts_here < (1 if noisy else 2)
    )
    signal = context.local_signal if context.local_signal is not None else context.sample_signal
    strong = signal is not None and signal >= settings.collect_signal_threshold
    peak_ok = context.at_signal_peak or (not context.refine_candidates and not noisy)
    if strong and attempts_allowed and peak_ok:
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
