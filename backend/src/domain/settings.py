"""Настройки миссии. Значения — допущения проекта (локальный судья), не правила организаторов."""
from __future__ import annotations

from dataclasses import dataclass

from domain.geometry import Point


@dataclass(frozen=True)
class MissionSettings:
    base: Point = Point(-2.0, -0.5)
    battery_initial: float = 60.0
    judge_mode: str = "local"
    robot_radius_m: float = 0.11
    clearance_margin_m: float = 0.10
    observation_max_age_s: float = 1.0
    arrival_tolerance_m: float = 0.12
    base_tolerance_m: float = 0.25
    collect_signal_threshold: float = 0.8
    approach_signal_threshold: float = 0.35
    max_collect_attempts: int = 4
    target_samples: int = 3
    max_decisions: int = 60
    stall_decisions: int = 30
    return_safety_factor: float = 1.3
    return_reserve: float = 3.0
    max_replans: int = 3
    nominal_energy_per_m: float = 1.0
    candidate_lattice_step_m: float = 0.5
    candidate_min_distance_m: float = 0.5
    candidate_max_distance_m: float = 3.5

    @property
    def clearance_m(self) -> float:
        return self.robot_radius_m + self.clearance_margin_m
