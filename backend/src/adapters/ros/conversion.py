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


class PoseHistory:
    """Короткая история поз odom по времени симуляции: scan проецируется позой своего момента.

    Проекция последней позой во время поворота сдвигает дальние попадания стены в свободное
    пространство, и они выглядят как новое препятствие.
    """

    def __init__(self, horizon_s: float = 1.0, tolerance_s: float = 0.05) -> None:
        self._horizon_s = horizon_s
        self._tolerance_s = tolerance_s
        self._samples: list[tuple[float, Pose]] = []

    def add(self, time_s: float, pose: Pose) -> None:
        if self._samples and time_s < self._samples[-1][0]:
            self._samples.clear()  # время пошло назад: новый прогон или перезапуск симуляции
        self._samples.append((time_s, pose))
        while self._samples and self._samples[0][0] < time_s - self._horizon_s:
            self._samples.pop(0)

    def clear(self) -> None:
        self._samples.clear()

    def at(self, time_s: float) -> Pose | None:
        """Интерполированная поза; None, если момент вне истории дальше допуска."""
        samples = self._samples
        if not samples or time_s < samples[0][0] - self._tolerance_s or time_s > samples[-1][0] + self._tolerance_s:
            return None
        if time_s <= samples[0][0]:
            return samples[0][1]
        for (earlier_s, earlier), (later_s, later) in zip(samples, samples[1:]):
            if earlier_s <= time_s <= later_s:
                fraction = 0.0 if later_s == earlier_s else (time_s - earlier_s) / (later_s - earlier_s)
                turn = math.atan2(math.sin(later.heading_rad - earlier.heading_rad),
                                  math.cos(later.heading_rad - earlier.heading_rad))
                heading = earlier.heading_rad + fraction * turn
                return Pose(earlier.x_m + fraction * (later.x_m - earlier.x_m),
                            earlier.y_m + fraction * (later.y_m - earlier.y_m),
                            math.atan2(math.sin(heading), math.cos(heading)))
        return samples[-1][1]
