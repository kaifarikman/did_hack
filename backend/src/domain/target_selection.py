"""Выбор следующей цели по полезности и полной стоимости: путь туда, возврат оттуда и запас.

Цена энергии растёт по мере исчерпания свободного запаса: при полной батарее агент исследует
дальние области, к концу — только близкие и дешёвые. Цель, после которой возврат не обеспечен,
не рассматривается вовсе. Это ранжирование; окончательную проверку маршрута делает исполнитель.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Callable

from domain.geometry import Point
from domain.subgoals import Candidate

EnergyAlong = Callable[[Point, Point], float]


def spare_energy(battery: float, return_now: float, reserve: float, action_energy: float = 0.0) -> float:
    """Энергия, которую можно потратить на поиск, не трогая возврат и резерв."""
    return battery - return_now - action_energy - reserve


def rank_by_utility(
    candidates: list[Candidate],
    robot: Point,
    base: Point,
    battery: float,
    battery_initial: float,
    reserve: float,
    energy_along: EnergyAlong,
    energy_price: float,
    action_energy: float = 0.0,
) -> list[Candidate]:
    return_now = energy_along(robot, base)
    spare = spare_energy(battery, return_now, reserve, action_energy)
    if spare <= 0:
        return []
    price = energy_price / max(0.2, spare / battery_initial)
    ranked = []
    for candidate in candidates:
        energy_to = energy_along(robot, candidate.point)
        energy_back = energy_along(candidate.point, base)
        if battery - energy_to - action_energy - energy_back - reserve < 0:
            continue  # после этой цели возврат не обеспечен
        extra_return = max(0.0, energy_back - return_now)
        utility = candidate.score - price * (energy_to + extra_return)
        ranked.append(replace(candidate, score=utility, energy_to=energy_to, energy_back=energy_back))
    ranked.sort(key=lambda candidate: candidate.score, reverse=True)
    return ranked
