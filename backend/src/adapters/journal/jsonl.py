"""Журнал JSONL на диске: по файлу на прогон, запись сразу сбрасывается на диск."""
from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import asdict
from pathlib import Path

from domain.journal import JournalDraft, JournalEntry, JournalKind

_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _entry_to_record(entry: JournalEntry) -> dict:
    record = asdict(entry.draft)
    record["kind"] = entry.draft.kind.value
    return {"sequence": entry.sequence, **record}


def _record_to_entry(record: dict) -> JournalEntry:
    sequence = record.pop("sequence")
    record["kind"] = JournalKind(record["kind"])
    record["evidence"] = tuple(record.get("evidence", ()))
    return JournalEntry(sequence, JournalDraft(**record))


class JsonlJournal:
    def __init__(self, directory: Path) -> None:
        self._directory = Path(directory)
        self._directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._counters: dict[str, int] = {}

    def _path(self, run_id: str) -> Path:
        if not _SAFE_RUN_ID.match(run_id):
            raise ValueError("недопустимый run_id для имени файла")
        return self._directory / f"{run_id}.jsonl"

    def _load(self, run_id: str) -> list[JournalEntry]:
        path = self._path(run_id)
        if not path.exists():
            return []
        with path.open(encoding="utf-8") as stream:
            return [_record_to_entry(json.loads(line)) for line in stream if line.strip()]

    def append(self, run_id: str, draft: JournalDraft) -> JournalEntry:
        with self._lock:
            if run_id not in self._counters:
                self._counters[run_id] = len(self._load(run_id))
            self._counters[run_id] += 1
            entry = JournalEntry(self._counters[run_id], draft)
            with self._path(run_id).open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(_entry_to_record(entry), ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            return entry

    def read(self, run_id: str, after_sequence: int, limit: int) -> tuple[list[JournalEntry], bool]:
        with self._lock:
            matching = [e for e in self._load(run_id) if e.sequence > after_sequence]
        return matching[:limit], len(matching) > limit

    def tail(self, run_id: str, count: int) -> list[JournalEntry]:
        with self._lock:
            return self._load(run_id)[-count:]
