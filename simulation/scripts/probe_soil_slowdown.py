"""Контрольный проезд: одинаковая команда внутри зоны замедления и вне её.

Запускать внутри контейнера simulation при остановленном судье (иначе он перезапишет состояние):
  pkill -f did_judge; python3 /workspace/simulation/scripts/probe_soil_slowdown.py
Зона покрывает старт робота, затем состояние удаляется, и проезд повторяется.
"""
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.scenario import SoilZone  # noqa: E402
from did_judge.soil_slowdown import DEFAULT_STATE_PATH, write_soil_state  # noqa: E402

COMMAND_SPEED_M_S = 0.1
DRIVE_S = 5.0
SPEED_FACTOR = 0.5
BASE = (-2.0, -0.5)


class Probe(Node):
    def __init__(self):
        super().__init__("soil_probe")
        self.position_x = None
        self.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self.publisher = self.create_publisher(TwistStamped, "/agent/cmd_vel", 10)

    def _on_odom(self, message):
        self.position_x = message.pose.pose.position.x

    def spin_for(self, seconds, drive):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if drive:
                command = TwistStamped()
                command.twist.linear.x = COMMAND_SPEED_M_S
                self.publisher.publish(command)
            rclpy.spin_once(self, timeout_sec=0.1)

    def drive_distance(self):
        self.spin_for(1.0, drive=False)
        start = self.position_x
        self.spin_for(DRIVE_S, drive=True)
        self.spin_for(1.0, drive=False)
        return self.position_x - start


def main():
    rclpy.init()
    probe = Probe()
    write_soil_state(DEFAULT_STATE_PATH, BASE, [SoilZone((-1.5, -0.5), 0.6)], SPEED_FACTOR)
    in_zone_m = probe.drive_distance()
    os.remove(DEFAULT_STATE_PATH)
    outside_m = probe.drive_distance()
    print(f"in_zone_m={in_zone_m:.3f} outside_m={outside_m:.3f} ratio={in_zone_m / outside_m:.3f} "
          f"expected_ratio={SPEED_FACTOR}")
    probe.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
