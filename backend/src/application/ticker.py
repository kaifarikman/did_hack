"""Фоновый цикл тиков исполнения, независимый от HTTP-запросов."""
from __future__ import annotations

import logging
import threading
import time

from application.run_service import RunService

logger = logging.getLogger(__name__)


class TickLoop:
    def __init__(self, service: RunService, period_s: float = 0.1) -> None:
        self._service = service
        self._period_s = period_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="mission-tick", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def shutdown(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self._service.tick()
            except Exception:  # цикл не должен умирать из-за ошибки одного тика
                logger.exception("ошибка тика миссии")
            self._stop.wait(max(0.0, self._period_s - (time.monotonic() - started)))
