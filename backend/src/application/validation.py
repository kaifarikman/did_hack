"""Проверка подцели исполнителем: схема, допустимость, достижимость, запас энергии."""
from __future__ import annotations

from dataclasses import dataclass

from application.navigation_service import NavigationService, Route
from domain.geometry import Point
from domain.observations import LocalizationStatus
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, Subgoal


@dataclass(frozen=True)
class GoalVerdict:
    accepted: bool
    reason: str = ""
    route: Route | None = None


def localization_energy_margin(error_m: float | None, status: LocalizationStatus) -> float:
    error = max(0.0, error_m or 0.0)
    if status is LocalizationStatus.DEGRADED:
        return 1.0 + max(0.2, min(0.5, error))
    return 1.0 + min(0.5, error)


def validate_subgoal(
    goal: Subgoal,
    position: Point,
    battery: float,
    signal: float | None,
    navigation: NavigationService,
    settings: MissionSettings,
    localization_error_m: float | None = None,
    localization_status: LocalizationStatus = LocalizationStatus.OK,
) -> GoalVerdict:
    uncertainty_margin = localization_energy_margin(localization_error_m, localization_status)
    if goal.kind is GoalKind.COLLECT:
        if signal is None:
            return GoalVerdict(False, "сбор невозможен: сигнал отсутствует")
        if signal < settings.collect_signal_threshold:
            return GoalVerdict(False, "сигнал ниже порога попытки сбора")
        return_estimate = navigation.return_energy(position)
        if return_estimate is None:
            return GoalVerdict(False, "после попытки сбора нет проверяемого маршрута на базу")
        required = (return_estimate * uncertainty_margin + settings.false_collect_energy_penalty
                    + settings.return_reserve)
        if battery < required:
            return GoalVerdict(False, f"не хватает энергии на сбор и возврат: нужно {required:.1f}, есть {battery:.1f}")
        return GoalVerdict(True)
    target = settings.base if goal.kind is GoalKind.RETURN else goal.target
    if target is None:
        return GoalVerdict(False, f"для {goal.kind.value} нужна целевая точка")
    if not navigation.is_reachable(target):
        return GoalVerdict(False, "цель вне карты или в запретной зоне")
    route = navigation.route(position, target)
    if route is None:
        return GoalVerdict(False, "цель недостижима")
    if goal.kind is GoalKind.RETURN:
        return GoalVerdict(True, route=route)
    return_estimate = navigation.return_energy(target)
    if return_estimate is None:
        return GoalVerdict(False, "из цели нет оценки возврата")
    required = ((route.energy + return_estimate) * uncertainty_margin
                + settings.false_collect_energy_penalty + settings.return_reserve)
    if battery < required:
        return GoalVerdict(False, f"не хватает энергии: нужно {required:.1f}, есть {battery:.1f}")
    return GoalVerdict(True, route=route)
