"""Модель Burger с пространством имён для запуска нескольких роботов в одном мире Gazebo.

Стандартная модель жёстко задаёт топики и кадры (`cmd_vel`, `odom`, `base_footprint`), поэтому два экземпляра
конфликтуют. Здесь из исходного SDF строится копия: топики `R/...`, кадры `R/...`, TF в `/R/tf`.
Каждая замена обязана сработать ровно один раз: при изменении исходной модели генерация падает, а не
молча даёт робота без изоляции.
"""
import re
import os
import sys
from typing import Dict, List

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.contacts import CONTACT_SENSOR_LINKS, gazebo_contact_topic  # noqa: E402

SDF_REPLACEMENTS = (
    (r'<model name="turtlebot3_burger">', '<model name="{robot}">'),
    (r"<topic>imu</topic>", "<topic>{robot}/imu</topic>"),
    (r"<topic>scan</topic>", "<topic>{robot}/scan</topic>"),
    (r"<topic>cmd_vel</topic>", "<topic>{robot}/cmd_vel</topic>"),
    (r"<topic>joint_states</topic>", "<topic>{robot}/joint_states</topic>"),
    (r"<odom_topic>odom</odom_topic>", "<odom_topic>{robot}/odom</odom_topic>"),
    (r"<gz_frame_id>base_scan</gz_frame_id>", "<gz_frame_id>{robot}/base_scan</gz_frame_id>"),
    (r"<frame_id>odom</frame_id>", "<frame_id>{robot}/odom</frame_id>"),
    (r"<child_frame_id>base_footprint</child_frame_id>",
     "<child_frame_id>{robot}/base_footprint</child_frame_id>"),
    (r"<tf_topic>/tf</tf_topic>", "<tf_topic>/{robot}/tf</tf_topic>"),
)


def namespaced_sdf(source_sdf: str, robot: str) -> str:
    result = source_sdf
    for pattern, template in SDF_REPLACEMENTS:
        result, count = re.subn(pattern, template.format(robot=robot), result)
        if count != 1:
            raise ValueError(f"Замена {pattern!r} сработала {count} раз вместо 1: исходная модель изменилась")
    return result


def bridge_arguments(robot: str) -> List[str]:
    """Аргументы parameter_bridge для одного робота; TF всех роботов сводится в общий /tf."""
    specs = [
        f"/{robot}/cmd_vel@geometry_msgs/msg/TwistStamped]gz.msgs.Twist",
        f"/{robot}/scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan",
        *[f"{gazebo_contact_topic(robot, link, sensor)}"
          "@ros_gz_interfaces/msg/Contacts[gz.msgs.Contacts"
          for link, sensor in CONTACT_SENSOR_LINKS],
        f"/{robot}/odom@nav_msgs/msg/Odometry[gz.msgs.Odometry",
        f"/{robot}/imu@sensor_msgs/msg/Imu[gz.msgs.IMU",
        f"/{robot}/joint_states@sensor_msgs/msg/JointState[gz.msgs.Model",
        f"/{robot}/tf@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V",
    ]
    return [*specs, "--ros-args", "-r", f"/{robot}/tf:=/tf"]


def contact_bridge_arguments(robot: str = "burger") -> List[str]:
    return [f"{gazebo_contact_topic(robot, link, sensor)}"
            "@ros_gz_interfaces/msg/Contacts[gz.msgs.Contacts"
            for link, sensor in CONTACT_SENSOR_LINKS]


def default_bases(count: int, first_base=(-2.0, -0.5), spacing_m: float = 1.0) -> Dict[str, tuple]:
    """Стартовые площадки в ряд вдоль оси Y; робот i возвращается на свою площадку."""
    return {f"robot_{index + 1}": (first_base[0], first_base[1] + index * spacing_m) for index in range(count)}
