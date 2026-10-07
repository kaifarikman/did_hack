"""Проба командного SLAM (после reset с map_mode=slam, robots=2).

Оба робота едут по небольшим квадратам; печатается:
- ошибка локализации каждого робота: |старт + TF(robotN/map -> robotN/base_footprint) - физическая поза Gazebo|;
- статистика объединённой карты /team/map;
- совпадение занятых клеток карты с эталонной картой мира (эталон читает только проба) и то же совпадение
  при намеренном двойном смещении на базу — метрика должна различать правильную и неправильную привязку.
Запуск: source /opt/ros/jazzy/setup.bash && GZ_PARTITION=did python3 /workspace/simulation/scripts/probe_team_slam.py
"""
import json
import math
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from tf2_ros import Buffer, TransformListener

SIMULATION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "judge"))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "scripts"))
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from robot_model import default_bases  # noqa: E402

ROBOTS = ("robot_1", "robot_2")
LINEAR_M_S, ANGULAR_RAD_S, SIDE_M, LAPS = 0.15, 0.5, 0.5, 2
MATCH_TOLERANCE_M = 0.06


class Probe(Node):
    def __init__(self):
        super().__init__("team_slam_probe")
        self.bases = default_bases(len(ROBOTS))
        self.tf_buffer = Buffer()
        TransformListener(self.tf_buffer, self)
        self.team_map = None
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.create_subscription(OccupancyGrid, "/team/map", lambda m: setattr(self, "team_map", m), latched)
        self.command_publishers = {r: self.create_publisher(TwistStamped, f"/{r}/agent/cmd_vel", 10) for r in ROBOTS}
        self.truth = GazeboPoseSource(ROBOTS)
        self.errors = {robot: [] for robot in ROBOTS}

    def drive_both(self, linear, angular, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            for robot in ROBOTS:
                command = TwistStamped()
                command.twist.linear.x, command.twist.angular.z = linear, angular
                self.command_publishers[robot].publish(command)
            rclpy.spin_once(self, timeout_sec=0.05)
            self.sample_errors()

    def sample_errors(self):
        for robot in ROBOTS:
            truth = self.truth.latest_for(robot)
            try:
                transform = self.tf_buffer.lookup_transform(f"{robot}/map", f"{robot}/base_footprint",
                                                            rclpy.time.Time())
            except Exception:
                continue
            if truth is None:
                continue
            base = self.bases[robot]
            self.errors[robot].append(math.hypot(base[0] + transform.transform.translation.x - truth[0],
                                                 base[1] + transform.transform.translation.y - truth[1]))


def occupied_world_points(message):
    info, points = message.info, []
    for index, value in enumerate(message.data):
        if value >= 65:
            row, column = divmod(index, info.width)
            points.append((info.origin.position.x + (column + 0.5) * info.resolution,
                           info.origin.position.y + (row + 0.5) * info.resolution))
    return points


def match_rate(points, reference, shift=(0.0, 0.0)):
    """Доля занятых клеток карты, у которых эталон занят в пределах допуска."""
    radius = math.ceil(MATCH_TOLERANCE_M / reference.resolution_m)
    hits = 0
    for x_m, y_m in points:
        column, row = reference.cell_of(x_m + shift[0], y_m + shift[1])
        if any(not reference.is_free(column + dc, row + dr)
               for dc in range(-radius, radius + 1) for dr in range(-radius, radius + 1)):
            hits += 1
    return hits / len(points) if points else 0.0


def main():
    rclpy.init()
    probe = Probe()
    probe.drive_both(0.0, 0.0, 4.0)
    for _ in range(LAPS * 4):
        probe.drive_both(LINEAR_M_S, 0.0, SIDE_M / LINEAR_M_S)
        probe.drive_both(0.0, ANGULAR_RAD_S, (math.pi / 2) / ANGULAR_RAD_S)
    probe.drive_both(0.0, 0.0, 5.0)
    reference = load_occupancy_grid(os.path.join(SIMULATION_DIR, "judge", "data", "map.yaml"))
    result = {"localization_error_m": {robot: {"samples": len(errors), "mean": round(sum(errors) / len(errors), 3),
                                               "max": round(max(errors), 3)}
                                       for robot, errors in probe.errors.items()}}
    message = probe.team_map
    points = occupied_world_points(message)
    info = message.info
    result["team_map"] = {"frame": message.header.frame_id, "width": info.width, "height": info.height,
                          "origin": [round(info.origin.position.x, 2), round(info.origin.position.y, 2)],
                          "known_cells": sum(1 for value in message.data if value >= 0),
                          "occupied_cells": len(points)}
    base_shift = default_bases(1)["robot_1"]
    result["occupied_match_with_reference"] = round(match_rate(points, reference), 3)
    result["occupied_match_if_double_shifted"] = round(match_rate(points, reference, base_shift), 3)
    result["occupied_match_if_shifted_0_3m"] = round(match_rate(points, reference, (0.3, 0.0)), 3)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    rclpy.shutdown()


if __name__ == "__main__":
    main()
