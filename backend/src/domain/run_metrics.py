"""Public, bounded analytics shared by the dashboard and planning context."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlannerMetrics:
    requests: int = 0
    deadline_timeouts: int = 0
    fallbacks: int = 0
    last_wait_wall_s: float | None = None


@dataclass(frozen=True)
class MetricPoint:
    simulation_time_s: float
    battery_remaining: float | None
    return_energy: float | None
    sample_signal: float | None
    speed_mps: float | None
    phase: str
    continuous: bool


@dataclass(frozen=True)
class RunMetricsSummary:
    run_id: str
    robot_id: str
    generation: int
    observation_sequence: int | None
    simulation_time_s: float | None
    distance_m: float
    speed_mps: float | None
    reserve_energy: float
    available_energy: float | None
    elapsed_sim_s: float
    elapsed_wall_s: float
    real_time_factor: float | None
    phase: str
    phase_seconds: tuple[tuple[str, float], ...]
    planner: PlannerMetrics


@dataclass(frozen=True)
class RunMetricsView:
    summary: RunMetricsSummary
    history: tuple[MetricPoint, ...]
    history_limit: int
    sample_interval_s: float
