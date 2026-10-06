"""Журнал в памяти: тесты и базовая реализация чтения."""
from __future__ import annotations

import threading

from domain.journal import JournalDraft, JournalEntry


class InMemoryJournal:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, list[JournalEntry]] = {}

    def append(self, run_id: str, draft: JournalDraft) -> JournalEntry:
        with self._lock:
            entries = self._entries.setdefault(run_id, [])
            entry = JournalEntry(len(entries) + 1, draft)
            entries.append(entry)
            return entry

    def read(self, run_id: str, after_sequence: int, limit: int) -> tuple[list[JournalEntry], bool]:
        with self._lock:
            matching = [e for e in self._entries.get(run_id, []) if e.sequence > after_sequence]
        return matching[:limit], len(matching) > limit

    def tail(self, run_id: str, count: int) -> list[JournalEntry]:
        with self._lock:
            return list(self._entries.get(run_id, [])[-count:])
