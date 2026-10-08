"""Преобразование публичных JSON-сообщений судьи в типы ядра (без зависимости от rclpy)."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass

from application.ports import PublicScore
from domain.events import EventKind, PublicEvent
from domain.geometry import Point


@dataclass(frozen=True)
class PublicTelemetry:
    generation: int
    simulation_time_s: float
    battery: float
    signal: float | None
    robot_id: str


def parse_public_telemetry(payload_json: str) -> PublicTelemetry | None:
    try:
        payload = json.loads(payload_json)
        generation = _generation(payload)
        robot_id = payload.get("robot_id", "robot_1")
        simulation_time_s = float(payload["simulation_time_s"])
        battery = float(payload["battery"])
        signal = payload.get("signal")
        signal = float(signal) if signal is not None else None
        if (generation is None or not isinstance(robot_id, str) or not robot_id
                or not math.isfinite(simulation_time_s) or simulation_time_s < 0
                or not math.isfinite(battery) or battery < 0
                or (signal is not None and (not math.isfinite(signal) or not 0 <= signal <= 1))):
            return None
        return PublicTelemetry(generation, simulation_time_s, battery, signal, robot_id)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, OverflowError):
        return None


def _generation(payload: dict) -> int | None:
    generation = payload.get("generation")
    if generation is not None and (type(generation) is not int or generation < 0):
        raise ValueError("invalid generation")
    return generation


def _position(payload: dict) -> Point | None:
    raw = payload.get("position")
    if raw is None:
        return None
    if (not isinstance(raw, list) or len(raw) != 2
            or any(not isinstance(value, (int, float)) or isinstance(value, bool)
                   or not math.isfinite(value) for value in raw)):
        raise ValueError("invalid event position")
    return Point(float(raw[0]), float(raw[1]))


def parse_public_event(payload_json: str, sequence: int) -> PublicEvent | None:
    """Декодирует только разрешённые публичные поля события судьи."""
    try:
        payload = json.loads(payload_json)
        kind = EventKind(payload["type"])
        payload_sequence = payload.get("sequence", sequence)
        if type(payload_sequence) is not int or payload_sequence <= 0:
            return None
        event_time = payload.get("simulation_time_s")
        battery = payload.get("battery")
        event_time = float(event_time) if event_time is not None else None
        battery = float(battery) if battery is not None else None
        if ((event_time is not None and not math.isfinite(event_time))
                or (battery is not None and not math.isfinite(battery))):
            return None
        return PublicEvent(
            sequence=payload_sequence,
            kind=kind,
            simulation_time_s=event_time,
            robot_id=str(payload.get("robot_id", "robot_1")),
            generation=_generation(payload),
            position=_position(payload),
            battery_after=battery,
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, OverflowError):
        return None


def parse_public_score(payload_json: str) -> PublicScore | None:
    """Декодирует минимальный публичный счёт для сверки исходов операций."""
    try:
        payload = json.loads(payload_json)
        if type(payload.get("collected")) is not int or type(payload.get("finished")) is not bool:
            return None
        collected = payload["collected"]
        finish_success = payload.get("finish_success")
        simulation_time_s = payload.get("simulation_time_s")
        if collected < 0 or (finish_success is not None and type(finish_success) is not bool):
            return None
        simulation_time_s = float(simulation_time_s) if simulation_time_s is not None else None
        if simulation_time_s is not None and not math.isfinite(simulation_time_s):
            return None
        robot_id = payload.get("robot_id", "robot_1")
        if not isinstance(robot_id, str) or not robot_id:
            return None
        return PublicScore(
            collected=collected,
            finished=payload["finished"],
            finish_success=finish_success,
            simulation_time_s=simulation_time_s,
            robot_id=robot_id,
            generation=_generation(payload),
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, OverflowError):
        return None
