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
    plan_id: str | None = None


@dataclass(frozen=True)
class Candidate:
    point: Point
    score: float  # полезность: ценность поиска минус цена энергии (после rank_by_utility)
    expected_signal: float
    energy_to: float | None = None  # консервативная оценка расхода до точки
    energy_back: float | None = None  # оценка возврата из точки на базу


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
    refine_candidates: tuple[Candidate, ...] = ()  # пробы вокруг робота при сильном сигнале
    at_signal_peak: bool = False  # сигнал здесь не ниже соседних измерений: место для попытки сбора
    local_signal: float | None = None  # среднее последних показаний в текущей точке (сглаживает шум)
    target_samples: int = 3  # сколько образцов может быть в профиле (публичное правило)
    sensor_state: str = "ok"  # ok | suspected | degraded | recovering
    sensor_quality: float = 1.0  # 0 — сигналом пользоваться нельзя
    sensor_unusable_s: float = 0.0  # сколько секунд сигнал непригоден
    terrain: tuple[TerrainView, ...] = ()
    recent_signals: tuple[tuple[Point, float], ...] = ()
    journal_tail: tuple[str, ...] = field(default_factory=tuple)
    mission_text: str = ""
    plan_id: str = "plan-0"
    model_epoch: int = 0  # версия существенных изменений модели; план с другой версией устарел
    map_revision: int = 0
    max_plan_steps: int = 3
    hypotheses: tuple[str, ...] = ()  # краткие формулировки гипотез и их статусов
    detections: tuple[str, ...] = ()  # обнаруженные изменения среды с detection_id
    hazards: tuple[tuple[Point, float], ...] = ()  # наблюдаемые опасные области (центр, радиус)
