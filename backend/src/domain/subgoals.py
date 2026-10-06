"""Подцели и контекст планирования: что планировщик видит и что он возвращает."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from domain.geometry import Point, Pose


class GoalKind(str, Enum):
    EXPLORE = "explore"
    APPROACH = "approach"
    COLLECT = "collect"
    RETURN = "return"


@dataclass(frozen=True)
class Subgoal:
    kind: GoalKind
    target: Point | None
    reason: str
    source: str = "fallback"  # "llm" или "fallback"
    hypothesis_id: str | None = None


@dataclass(frozen=True)
class Candidate:
    point: Point
    score: float
    expected_signal: float


@dataclass(frozen=True)
class TerrainView:
    center: Point
    radius_m: float
    energy_per_m: float
    confidence: float


@dataclass(frozen=True)
class PlanningContext:
    """Только разрешённые наблюдения: никакой скрытой разметки судьи."""

    run_id: str
    pose: Pose
    base: Point
    battery_remaining: float
    battery_initial: float
    sample_signal: float | None
    best_signal: float | None
    samples_collected: int
    return_energy_estimate: float | None
    reserve_low: bool
    decisions_made: int
    decisions_since_improvement: int
    collect_attempts_here: int
    total_collect_attempts: int
    candidates: tuple[Candidate, ...] = ()
    terrain: tuple[TerrainView, ...] = ()
    recent_signals: tuple[tuple[Point, float], ...] = ()
    journal_tail: tuple[str, ...] = field(default_factory=tuple)
