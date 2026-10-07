"""Общие fixtures контракта F02 и проверки, которые используют тесты ядра и ROS-адаптеров.

Адаптер A сравнивает свой результат с `load_*`: одинаковый JSON — одинаковые доменные значения.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from application.ports import (
    CONTRACT_VERSION, JudgeReply, MapMode, OperationOutcome, PublicScore, ResetAck, ResetRequest,
)
from domain.events import EventKind, PublicEvent
from domain.geometry import Point, Pose
from domain.grid import OccupancyGrid
from domain.observations import LocalizationStatus, Observation

FIXTURES = Path(__file__).parent / "fixtures" / "contract"


def read_fixture(name: str) -> dict:
    payload = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    if payload["contract_version"] != CONTRACT_VERSION:
        raise AssertionError(f"{name}: версия {payload['contract_version']} != {CONTRACT_VERSION}")
    return payload


def _point(raw: dict | None) -> Point | None:
    return None if raw is None else Point(raw["position_x_m"], raw["position_y_m"])


def _pose(raw: dict | None) -> Pose | None:
    return None if raw is None else Pose(raw["position_x_m"], raw["position_y_m"], raw["heading_rad"])


def observation_from_json(raw: dict) -> Observation:
    return Observation(
        simulation_time_s=raw["simulation_time_s"], pose=_pose(raw["pose"]),
        battery_remaining=raw["battery_remaining"], sample_signal=raw["sample_signal"],
        received_monotonic_s=raw["received_monotonic_s"], penalty_recent=raw["penalty_recent"],
        robot_id=raw["robot_id"], sequence=raw["sequence"], generation=raw["generation"],
        sample_signal_age_s=raw["sample_signal_age_s"], localization=LocalizationStatus(raw["localization"]),
        localization_error_m=raw["localization_error_m"],
    )


def load_observation(name: str) -> Observation:
    return observation_from_json(read_fixture(name)["observation"])


def load_events(name: str = "events.json") -> list[PublicEvent]:
    return [
        PublicEvent(
            sequence=raw["sequence"], kind=EventKind(raw["kind"]), simulation_time_s=raw["simulation_time_s"],
            robot_id=raw["robot_id"], generation=raw["generation"], position=_point(raw["position"]),
            battery_after=raw["battery_after"],
        )
        for raw in read_fixture(name)["events"]
    ]


def _reset_ack(raw: dict) -> ResetAck:
    return ResetAck(raw["generation"], raw["scenario"], raw["seed"], MapMode(raw["map_mode"]),
                    tuple(raw["robot_ids"]), tuple(raw["notes"]))


def load_reset() -> tuple[ResetRequest, ResetAck, ResetAck]:
    payload = read_fixture("reset.json")
    raw = payload["request"]
    request = ResetRequest(raw["scenario"], raw["seed"], raw["generation"], MapMode(raw["map_mode"]),
                           tuple(raw["robot_ids"]))
    return request, _reset_ack(payload["ack"]), _reset_ack(payload["stale_ack"])


def load_judge() -> tuple[dict[str, JudgeReply], PublicScore]:
    payload = read_fixture("judge.json")
    replies = {
        name: JudgeReply(raw["success"], raw["message"], OperationOutcome(raw["outcome"]))
        for name, raw in payload["replies"].items()
    }
    raw = payload["score"]
    score = PublicScore(raw["collected"], raw["finished"], raw["finish_success"], raw["simulation_time_s"],
                        raw["robot_id"])
    return replies, score


def load_map(name: str = "map-slam-partial.json") -> OccupancyGrid:
    raw = read_fixture(name)["map"]
    return OccupancyGrid(raw["map_id"], raw["resolution_m"], raw["width"], raw["height"],
                         _pose(raw["origin"]), raw["cells"], raw["revision"], raw["frame_id"])


def assert_observation_valid(observation: Observation) -> None:
    """Инварианты, которые обязан соблюдать любой адаптер наблюдений."""
    if observation.sample_signal is not None:
        assert 0.0 <= observation.sample_signal <= 1.0 and math.isfinite(observation.sample_signal)
    for value in (observation.battery_remaining, observation.simulation_time_s, observation.sample_signal_age_s):
        assert value is None or math.isfinite(value), "NaN/inf — это отсутствующее измерение (None)"
    if observation.pose is not None:
        assert all(math.isfinite(v) for v in (observation.pose.x_m, observation.pose.y_m, observation.pose.heading_rad))
    assert observation.robot_id, "robot_id обязателен"
    assert isinstance(observation.localization, LocalizationStatus)
