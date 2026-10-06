"""Преобразования ROS-значений в единицы контракта. Без rclpy: проверяется обычными тестами."""
from __future__ import annotations

import json
import math

from domain.geometry import Pose

# ТЗ: x_world = -2.0 + odom.x, y_world = -0.5 + odom.y
ODOM_TO_WORLD_X_M = -2.0
ODOM_TO_WORLD_Y_M = -0.5

PENALTY_EVENT_TYPES = frozenset({"collision", "false_collect", "hazard_hit"})


def yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def world_pose_from_odom(odom_x_m: float, odom_y_m: float, yaw_rad: float) -> Pose | None:
    """None, если значения не конечны: неверное измерение не превращается в позу."""
    if not all(math.isfinite(value) for value in (odom_x_m, odom_y_m, yaw_rad)):
        return None
    return Pose(ODOM_TO_WORLD_X_M + odom_x_m, ODOM_TO_WORLD_Y_M + odom_y_m, yaw_rad)


def finite_or_none(value: float) -> float | None:
    return float(value) if math.isfinite(value) else None


def clamp_signal(value: float) -> float | None:
    if not math.isfinite(value):
        return None
    return min(1.0, max(0.0, float(value)))


def is_penalty_event(payload: str) -> bool:
    """Штрафное событие судьи; нечитаемый JSON не считается штрафом."""
    try:
        event = json.loads(payload)
    except (TypeError, ValueError):
        return False
    return isinstance(event, dict) and event.get("type") in PENALTY_EVENT_TYPES
