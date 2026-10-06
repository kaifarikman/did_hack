"""Проверка подцели исполнителем: схема, допустимость, достижимость, запас энергии."""
from __future__ import annotations

from dataclasses import dataclass

from application.navigation_service import NavigationService, Route
from domain.geometry import Point
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, Subgoal


@dataclass(frozen=True)
class GoalVerdict:
    accepted: bool
    reason: str = ""
    route: Route | None = None


def validate_subgoal(
    goal: Subgoal,
    position: Point,
    battery: float,
    signal: float | None,
    navigation: NavigationService,
    settings: MissionSettings,
) -> GoalVerdict:
    if goal.kind is GoalKind.COLLECT:
        if signal is None:
            return GoalVerdict(False, "сбор невозможен: сигнал отсутствует")
        if signal < settings.collect_signal_threshold:
            return GoalVerdict(False, "сигнал ниже порога попытки сбора")
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
    required = route.energy + return_estimate + settings.return_reserve
    if battery < required:
        return GoalVerdict(False, f"не хватает энергии: нужно {required:.1f}, есть {battery:.1f}")
    return GoalVerdict(True, route=route)
