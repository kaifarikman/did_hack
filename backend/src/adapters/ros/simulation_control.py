"""Сброс симуляции через внутренний HTTP супервизора и согласованный сброс кэша наблюдений."""
from __future__ import annotations

import json
import urllib.request
from typing import Callable


class SupervisorSimulationControl:
    def __init__(self, supervisor_url: str, on_reset: Callable[[], None], timeout_s: float = 180.0) -> None:
        self._url = supervisor_url.rstrip("/")
        self._on_reset = on_reset
        self._timeout_s = timeout_s

    def reset(self, scenario: str, seed: int) -> None:
        self._on_reset()  # старые наблюдения не должны попасть в новый прогон
        request = urllib.request.Request(
            f"{self._url}/reset", data=json.dumps({"seed": seed, "scenario": scenario}).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(request, timeout=self._timeout_s) as response:  # HTTPError = отказ
            if response.status != 200:
                raise RuntimeError(f"супервизор вернул {response.status}")
        self._on_reset()
