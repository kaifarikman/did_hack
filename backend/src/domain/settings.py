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
    planning_raster_margin_m: float = 0.05  # запас статической карты на дискретизацию растра сверх clearance
    rotation_margin_m: float = 0.03  # запас поворота на месте сверх радиуса корпуса (шум lidar)
    blocked_escalation_s: float = 10.0  # дольше коридор закрыт без продвижения — обработка как застревания
    dynamic_obstacle_ttl_s: float = 1.0
    dynamic_obstacle_confirmations: int = 2
    dynamic_obstacle_confirmation_window_s: float = 0.35
    dynamic_obstacle_cell_m: float = 0.10
    # попадание scan ближе этого к препятствию карты — та же стена, а не новое препятствие;
    # допуск растёт с дальностью: ошибка курса при проекции во время поворота сдвигает дальние точки
    static_hit_match_m: float = 0.10
    scan_heading_uncertainty_rad: float = 0.25
    static_hit_match_max_m: float = 0.45
    dynamic_obstacle_max_range_m: float = 1.5  # дальше overlay не строится: при сдвиге курса 0.25 рад ошибка ≤ 0.375 м
    path_deviation_tolerance_m: float = 0.30
    path_deviation_hysteresis_m: float = 0.05
    path_deviation_confirmation_s: float = 0.60
    path_replan_cooldown_s: float = 2.0
    max_linear_mps: float = 0.15
    braking_deceleration_mps2: float = 0.25
    scan_reaction_s: float = 0.15
    observation_max_age_s: float = 1.0
    localization_recovery_s: float = 5.0
    arrival_tolerance_m: float = 0.12
    stuck_window_s: float = 6.0
    stuck_min_progress_m: float = 0.05
    base_tolerance_m: float = 0.25
    collect_signal_threshold: float = 0.8
    false_collect_energy_penalty: float = 2.0  # worst-case action cost from the local judge
    approach_signal_threshold: float = 0.35
    refine_signal_threshold: float = 0.65  # выше — уточняющие пробы вокруг робота перед сбором
    refine_step_m: float = 0.25
    energy_price: float = 0.15  # ценность единицы энергии при полной батарее; растёт по мере расхода
    detour_factor: float = 1.3  # прямая оценка пути занижает реальный маршрут
    max_planner_requests: int = 80  # лимит запросов плана за прогон; дальше — алгоритмический резерв
    min_planner_interval_s: float = 1.0
    planner_timeout_s: float = 10.0  # зависший ответ заменяется проверяемой алгоритмической целью
    max_plan_steps: int = 3
    sensor_wait_s: float = 15.0
    map_wait_s: float = 20.0  # сколько ждать первой карты SLAM
    pose_jump_m: float = 0.25
    yield_max_s: float = 8.0  # дольше ждать партнёра нельзя: цель отдаётся, выбирается другая  # скачок позы за тик больше этого — коррекция локализации  # сколько ждать восстановления неисправного датчика до возврата
    max_collect_attempts: int = 4
    target_samples: int = 3
    max_decisions: int = 60
    stall_decisions: int = 30
    return_safety_factor: float = 1.3
    return_reserve: float = 3.0
    max_replans: int = 3
    navigation_blocked_wait_s: float = 8.0  # сколько ждать открытия пути к цели навигации до возврата
    stuck_recovery_reverse_m: float = 0.12
    stuck_recovery_turn_rad: float = 0.60
    stuck_recovery_reverse_speed_mps: float = 0.06
    stuck_recovery_turn_speed_radps: float = 0.40
    stuck_recovery_timeout_s: float = 4.0
    stuck_recovery_energy_budget: float = 1.0
    max_stuck_recovery_attempts_per_goal: int = 1
    nominal_energy_per_m: float = 1.0
    candidate_lattice_step_m: float = 0.5
    candidate_min_distance_m: float = 0.5
    candidate_max_distance_m: float = 3.5

    @property
    def clearance_m(self) -> float:
        return self.robot_radius_m + self.clearance_margin_m
