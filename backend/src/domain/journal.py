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


@dataclass(frozen=True)
class JournalEntry:
    sequence: int
    draft: JournalDraft
