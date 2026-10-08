"""Проверка пользовательской цели навигации: карта, корпус, путь туда и домой, действие и резерв.

Одна проверка используется до сброса (от базы с начальной батареей) и после сброса
(от свежей позы с фактической батареей): исход старого снимка не считается обещанием.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from application.navigation_service import NavigationService, Route
from domain.geometry import Point
from domain.settings import MissionSettings


class TargetProblem(str, Enum):
    OUTSIDE_MAP = "outside_map"
    BLOCKED = "blocked"
    OCCUPIED_NOW = "occupied_now"  # свежий scan закрыл цель; по карте она допустима
    NO_PATH = "no_path"
    NO_RETURN = "no_return"
    ENERGY = "energy"

    @property
    def transient(self) -> bool:
        """Путь может открыться, когда уйдёт динамическое препятствие; геометрия карты и энергия — нет."""
        return self in (TargetProblem.OCCUPIED_NOW, TargetProblem.NO_PATH, TargetProblem.NO_RETURN)


@dataclass(frozen=True)
class TargetAssessment:
    problem: TargetProblem | None
    message: str
    route: Route | None = None
    required_energy: float | None = None

    @property
    def accepted(self) -> bool:
        return self.problem is None


def assess_navigation_target(
    navigation: NavigationService,
    settings: MissionSettings,
    start: Point,
    target: Point,
    battery: float,
    uncertainty_margin: float = 1.0,
) -> TargetAssessment:
    if not navigation.contains(target):
        return TargetAssessment(TargetProblem.OUTSIDE_MAP, "Цель вне границ карты.")
    if not navigation.is_statically_reachable(target):
        return TargetAssessment(
            TargetProblem.BLOCKED,
            "Цель в препятствии, неизвестной клетке или ближе допустимого запаса корпуса к стене.",
        )
    if not navigation.is_reachable(target):
        return TargetAssessment(TargetProblem.OCCUPIED_NOW, "Свежий scan видит препятствие у цели.")
    route = navigation.route(start, target)
    if route is None:
        return TargetAssessment(TargetProblem.NO_PATH, "Нет допустимого пути до цели.")
    return_energy = navigation.return_energy(target)
    if return_energy is None:
        return TargetAssessment(TargetProblem.NO_RETURN, "Из цели нет допустимого пути на базу.")
    # действие оценивается худшей ценой операции судьи, как у исследовательских подцелей
    required = ((route.energy + return_energy) * uncertainty_margin
                + settings.false_collect_energy_penalty + settings.return_reserve)
    if battery < required:
        return TargetAssessment(
            TargetProblem.ENERGY,
            f"Не хватает энергии на путь туда, обратно и резерв: нужно {required:.1f}, есть {battery:.1f}.",
            route, required,
        )
    return TargetAssessment(None, "Цель допустима.", route, required)
