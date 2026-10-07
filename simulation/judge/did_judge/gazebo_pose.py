"""Физическая поза робота из Gazebo, независимая от одометрии.

Подписка идёт напрямую через gz-transport внутри процесса судьи: истинная поза не публикуется
в ROS и недоступна агенту. Разбор сообщения отделён от транспорта и проверяется без Gazebo.
"""
import math
import threading
from typing import Optional, Tuple

ROBOT_ENTITY_NAME = "burger"
POSE_TOPIC = "/world/default/pose/info"

Pose = Tuple[float, float, float]  # x, y, yaw в мировых координатах


def yaw_of_quaternion(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def extract_robot_pose(pose_vector, entity_name: str = ROBOT_ENTITY_NAME) -> Optional[Pose]:
    """Поза корневой модели робота; вложенные звенья имеют то же имя только у других сущностей."""
    for entity in pose_vector.pose:
        if entity.name == entity_name:
            orientation = entity.orientation
            return (entity.position.x, entity.position.y,
                    yaw_of_quaternion(orientation.x, orientation.y, orientation.z, orientation.w))
    return None


class GazeboPoseSource:
    """Хранит последнюю физическую позу; читается из потока ROS без гонок."""

    def __init__(self) -> None:
        from gz.msgs10.pose_v_pb2 import Pose_V
        from gz.transport13 import Node
        self._lock = threading.Lock()
        self._latest: Optional[Pose] = None
        self._node = Node()
        if not self._node.subscribe(Pose_V, POSE_TOPIC, self._on_message):
            raise RuntimeError(f"Не удалось подписаться на {POSE_TOPIC}")

    def _on_message(self, message) -> None:
        pose = extract_robot_pose(message)
        if pose is not None:
            with self._lock:
                self._latest = pose

    def latest(self) -> Optional[Pose]:
        with self._lock:
            return self._latest
