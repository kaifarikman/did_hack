"""Чтение разрешённых событий: только текущее поколение и робот, каждое событие — один раз."""
from __future__ import annotations

from application.ports import EventSource
from domain.events import PublicEvent


class EventFeed:
    def __init__(self, source: EventSource, generation: int, robot_id: str) -> None:
        self._source = source
        self._generation = generation
        self._robot_id = robot_id
        self._last_sequence = 0
        self._seen: set[int] = set()

    def poll(self) -> list[PublicEvent]:
        fresh: list[PublicEvent] = []
        for event in self._source.events_after(self._last_sequence):
            if event.generation is not None and event.generation != self._generation:
                continue  # позднее событие прошлого прогона
            if event.robot_id != self._robot_id or event.sequence in self._seen:
                continue  # чужой робот или повторная доставка
            self._seen.add(event.sequence)
            self._last_sequence = max(self._last_sequence, event.sequence)
            fresh.append(event)
        return fresh
