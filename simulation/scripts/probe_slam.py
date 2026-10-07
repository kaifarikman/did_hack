"""Проба SLAM: проезд по квадрату, сравнение позы SLAM с физической позой Gazebo, статистика карты.

Запуск внутри контейнера simulation после reset с map_mode=slam:
  source /opt/ros/jazzy/setup.bash && GZ_PARTITION=did python3 /workspace/simulation/scripts/probe_slam.py
Ожидание: кадр map начинается в точке старта робота, поэтому world = base + map-поза.
Ошибка локализации — расстояние между этими двумя оценками; истинная поза используется только пробой.
"""
import math
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from tf2_ros import Buffer, TransformListener

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402

BASE = (-2.0, -0.5)
LINEAR_M_S = 0.15
ANGULAR_RAD_S = 0.5
SIDE_M = 0.5
LAPS = 2


class SlamProbe(Node):
    def __init__(self):
        super().__init__("slam_probe")
        self.tf_buffer = Buffer()
        TransformListener(self.tf_buffer, self)
        self.map_message = None
        self.create_subscription(OccupancyGrid, "/map", self._on_map, 1)
        self.publisher = self.create_publisher(TwistStamped, "/agent/cmd_vel", 10)
        self.truth = GazeboPoseSource()
        self.errors = []

    def _on_map(self, message):
        self.map_message = message

    def drive(self, linear, angular, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            command = TwistStamped()
            command.twist.linear.x = linear
            command.twist.angular.z = angular
            self.publisher.publish(command)
            rclpy.spin_once(self, timeout_sec=0.05)
            self.sample_error()

    def sample_error(self):
        truth = self.truth.latest()
        try:
            transform = self.tf_buffer.lookup_transform("map", "base_footprint", rclpy.time.Time())
        except Exception:
            return
        if truth is None:
            return
        slam_x = BASE[0] + transform.transform.translation.x
        slam_y = BASE[1] + transform.transform.translation.y
        self.errors.append(math.hypot(slam_x - truth[0], slam_y - truth[1]))

    def map_statistics(self):
        if self.map_message is None:
            return None
        cells = self.map_message.data
        return {"width": self.map_message.info.width, "height": self.map_message.info.height,
                "resolution": round(self.map_message.info.resolution, 3),
                "origin": (round(self.map_message.info.origin.position.x, 2),
                           round(self.map_message.info.origin.position.y, 2)),
                "known": sum(1 for value in cells if value >= 0),
                "occupied": sum(1 for value in cells if value > 50)}


def main():
    rclpy.init()
    probe = SlamProbe()
    probe.drive(0.0, 0.0, 3.0)
    for _ in range(LAPS * 4):
        probe.drive(LINEAR_M_S, 0.0, SIDE_M / LINEAR_M_S)
        probe.drive(0.0, ANGULAR_RAD_S, (math.pi / 2) / ANGULAR_RAD_S)
    probe.drive(0.0, 0.0, 3.0)
    errors = probe.errors
    print(f"samples={len(errors)} error_mean_m={sum(errors) / len(errors):.3f} "
          f"error_max_m={max(errors):.3f} error_final_m={errors[-1]:.3f}")
    print("map:", probe.map_statistics())
    rclpy.shutdown()


if __name__ == "__main__":
    main()
