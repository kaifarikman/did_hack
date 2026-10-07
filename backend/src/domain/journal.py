"""Запись журнала исследования."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class JournalKind(str, Enum):
    OBSERVATION = "observation"
    HYPOTHESIS = "hypothesis"
    EXPERIMENT = "experiment"
    DECISION = "decision"
    OUTCOME = "outcome"
    ERROR = "error"


@dataclass(frozen=True)
class JournalDraft:
    kind: JournalKind
    title: str
    detail: str
    simulation_time_s: float | None = None
    hypothesis_id: str | None = None
    expected: str | None = None
    observed: str | None = None
    conclusion: str | None = None
    experiment_id: str | None = None
    detection_id: str | None = None  # обнаружение изменения: связывает причину, модель и план
    plan_id: str | None = None
    evidence: tuple[str, ...] = ()  # идентификаторы исходных измерений/событий, например "segment-12"


@dataclass(frozen=True)
class JournalEntry:
    sequence: int
    draft: JournalDraft
