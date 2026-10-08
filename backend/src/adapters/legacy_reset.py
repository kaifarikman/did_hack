"""Проверки возможностей legacy-режима для сред, которые принимают только seed."""
from __future__ import annotations

from typing import Protocol

from application.ports import MapMode, ResetAck, ResetRequest
from domain.observations import DEFAULT_ROBOT_ID

LEGACY_SCENARIOS = ("easy", "medium", "hard")


class SeedOnlyReset(Protocol):
    def reset(self, scenario: str, seed: int) -> None: ...


class UnsupportedReset(Exception):
    """Среда не может применить запрошенный профиль."""


class LegacySimulationControl:
    def __init__(self, legacy: SeedOnlyReset) -> None:
        self._legacy = legacy

    def reset(self, request: ResetRequest) -> ResetAck:
        if request.scenario not in LEGACY_SCENARIOS:
            raise UnsupportedReset(f"супервизор MVP не поддерживает сценарий {request.scenario}")
        if request.map_mode is not MapMode.STATIC or request.robot_ids != (DEFAULT_ROBOT_ID,):
            raise UnsupportedReset("супервизор MVP поддерживает одного робота и готовую карту")
        self._legacy.reset(request.scenario, request.seed)
        return ResetAck(
            generation=request.generation, scenario=request.scenario, seed=request.seed,
            notes=("legacy_supervisor: поколение ROS-сообщениями не подтверждается",),
        )
