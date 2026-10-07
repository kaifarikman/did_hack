"""Публичные правила профилей ТЗ и лимиты поиска для каждого профиля.

Число образцов и грунтовых зон профиля опубликовано в ТЗ (easy 3/1, medium 5/3, hard 7/4) и не
является скрытой истиной: агент знает только, сколько образцов может быть, но не где они.
Лимиты поиска — допущения проекта, выбранные прогоном `scripts/analysis/search_limits.py`
на подменной среде; результаты — `artifacts/analysis/search-limits.json`.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

from domain.settings import MissionSettings


@dataclass(frozen=True)
class ProfileRules:
    sample_count: int
    soil_zone_count: int


PUBLIC_PROFILES: dict[str, ProfileRules] = {
    "easy": ProfileRules(3, 1),
    "medium": ProfileRules(5, 3),
    "hard": ProfileRules(7, 4),
}


@dataclass(frozen=True)
class SearchLimits:
    max_false_collects: int  # общий лимит неудачных сборов: каждый стоит энергии и очков
    stall_decisions: int  # решений без улучшения сигнала до признания поиска исчерпанным
    max_decisions: int  # страховка от бесконечного цикла; энергия обычно кончается раньше


SEARCH_LIMITS: dict[str, SearchLimits] = {
    "easy": SearchLimits(max_false_collects=4, stall_decisions=30, max_decisions=80),
    "medium": SearchLimits(max_false_collects=5, stall_decisions=30, max_decisions=120),
    "hard": SearchLimits(max_false_collects=6, stall_decisions=30, max_decisions=160),
}


def settings_for_profile(profile: str, base: MissionSettings, limits: SearchLimits | None = None) -> MissionSettings:
    """Настройки прогона: цель — все образцы профиля, лимиты — из таблицы профиля."""
    rules = PUBLIC_PROFILES[profile]
    chosen = limits or SEARCH_LIMITS[profile]
    return replace(
        base,
        target_samples=rules.sample_count,
        max_collect_attempts=chosen.max_false_collects,
        stall_decisions=chosen.stall_decisions,
        max_decisions=chosen.max_decisions,
    )
