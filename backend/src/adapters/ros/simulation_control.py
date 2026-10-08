"""Сброс симуляции через supervisor с проверкой фактически поднятой конфигурации."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Callable

from application.ports import MapMode, ResetAck, ResetRequest


class SupervisorSimulationControl:
    """Адаптер supervisor API; не подтверждает reset по одному HTTP 200."""

    def __init__(self, supervisor_url: str, on_reset: Callable[[], None], timeout_s: float = 180.0,
                 set_generation: Callable[[int], None] | None = None) -> None:
        self._url = supervisor_url.rstrip("/")
        self._on_reset = on_reset
        self._timeout_s = timeout_s
        self._set_generation = set_generation

    def reset(self, reset_request: ResetRequest) -> ResetAck:
        if not reset_request.robot_ids:
            raise ValueError("для сброса требуется хотя бы один robot_id")
        if len(set(reset_request.robot_ids)) != len(reset_request.robot_ids):
            raise ValueError("robot_ids должны быть уникальны")
        if reset_request.robot_ids != tuple(
            f"robot_{index}" for index in range(1, len(reset_request.robot_ids) + 1)
        ):
            raise ValueError("supervisor поддерживает robot_id от robot_1 по порядку")

        # Старые данные сбрасываем до перезапуска, чтобы контроллер не мог их принять за новые.
        self._on_reset()
        payload = {
            "seed": reset_request.seed,
            "scenario": reset_request.scenario,
            "map_mode": reset_request.map_mode.value,
            "robots": len(reset_request.robot_ids),
            "generation": reset_request.generation,
        }
        http_request = urllib.request.Request(
            f"{self._url}/reset",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout_s) as response:
                response_body = response.read()
        except urllib.error.HTTPError as error:
            # Сохраняем текст ответа supervisor для журнала причины отказа.
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"supervisor отклонил reset ({error.code}): {detail}") from error

        try:
            body = json.loads(response_body)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("supervisor вернул некорректный JSON при reset") from error
        if not isinstance(body, dict):
            raise RuntimeError("supervisor вернул некорректное подтверждение reset")

        expected = {
            "state": "ready",
            "seed": reset_request.seed,
            "scenario": reset_request.scenario,
            "map_mode": reset_request.map_mode.value,
            "robots": len(reset_request.robot_ids),
            "generation": reset_request.generation,
        }
        mismatches = [f"{key}={body.get(key)!r} (ожидалось {value!r})"
                      for key, value in expected.items() if body.get(key) != value]
        if mismatches:
            raise RuntimeError("supervisor не подтвердил запрошенную конфигурацию: " + ", ".join(mismatches))

        if self._set_generation is not None:
            self._set_generation(reset_request.generation)
        self._on_reset()
        if self._set_generation is not None:
            self._set_generation(reset_request.generation)
        return ResetAck(
            generation=reset_request.generation,
            scenario=reset_request.scenario,
            seed=reset_request.seed,
            map_mode=reset_request.map_mode,
            robot_ids=reset_request.robot_ids,
            notes=("supervisor подтвердил ready, seed, scenario, map_mode, число роботов и generation",),
        )

    def current_generation(self) -> int:
        """Читает generation живого supervisor для восстановления счётчика backend после рестарта."""
        request = urllib.request.Request(f"{self._url}/status", method="GET")
        try:
            with urllib.request.urlopen(request, timeout=min(self._timeout_s, 5.0)) as response:
                body = json.loads(response.read())
        except (urllib.error.URLError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError(f"не удалось прочитать generation supervisor: {error}") from error
        if (not isinstance(body, dict) or body.get("state") != "ready"
                or type(body.get("generation")) is not int or body["generation"] < 0):
            raise RuntimeError("supervisor не предоставил подтверждённое активное generation")
        return body["generation"]
