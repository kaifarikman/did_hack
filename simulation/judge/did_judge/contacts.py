"""Physical-contact filtering for Gazebo contact sensor messages."""
from __future__ import annotations


GROUND_COLLISION_MARKERS = ("ground_plane::", "ground::")
CONTACT_SENSOR_LINKS = (
    ("base_link", "base_contact"),
    ("base_scan", "lidar_contact"),
    ("wheel_left_link", "wheel_left_contact"),
    ("wheel_right_link", "wheel_right_contact"),
    ("caster_back_link", "caster_contact"),
)


def gazebo_contact_topic(robot_model: str, link_name: str, sensor_name: str) -> str:
    return f"/world/default/model/{robot_model}/link/{link_name}/sensor/{sensor_name}/contact"


def has_obstacle_contact(message, robot_model: str) -> bool:
    """Return true only when a robot collision touches a non-ground collision.

    Ground contacts are continuously reported by wheel and chassis sensors, so they
    must not become collision penalties. Lidar proximity is intentionally not used.
    """
    robot_prefix = f"{robot_model}::"
    for contact in message.contacts:
        first = contact.collision1.name
        second = contact.collision2.name
        if first.startswith(robot_prefix) and _is_obstacle(second):
            return True
        if second.startswith(robot_prefix) and _is_obstacle(first):
            return True
    return False


def _is_obstacle(collision_name: str) -> bool:
    return bool(collision_name) and not any(marker in collision_name for marker in GROUND_COLLISION_MARKERS)
