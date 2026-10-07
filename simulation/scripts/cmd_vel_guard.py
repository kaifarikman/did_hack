"""Страж скорости у робота: /agent/cmd_vel -> /cmd_vel, при тишине команд публикует ноль.

Останавливает робота, даже если процесс backend пропал (gz-диффдрайв сам таймаута не имеет).
На грунте уменьшает линейную скорость на коэффициент среды: замедление не зависит от агента.
"""
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.soil_slowdown import DEFAULT_STATE_PATH, speed_factor_at  # noqa: E402

AGENT_TOPIC = "/agent/cmd_vel"
ROBOT_TOPIC = "/cmd_vel"
ROBOT_ID_ENV = "ROBOT_ID"      # при нескольких роботах: /<id>/agent/cmd_vel -> /<id>/cmd_vel
ROBOT_BASE_ENV = "ROBOT_BASE"  # "x,y" стартовой площадки робота в мире
COMMAND_TIMEOUT_S = 0.5
CHECK_PERIOD_S = 0.1


class CmdVelGuard(Node):
    def __init__(self, robot_id=None, base=None):
        super().__init__(f"cmd_vel_guard_{robot_id}" if robot_id else "cmd_vel_guard")
        prefix = f"/{robot_id}" if robot_id else ""
        self._base = base
        self._last_command_s = 0.0
        self._odom_position = (0.0, 0.0)
        self._publisher = self.create_publisher(TwistStamped, prefix + ROBOT_TOPIC, 10)
        self.create_subscription(TwistStamped, prefix + AGENT_TOPIC, self._relay, 10)
        self.create_subscription(Odometry, prefix + "/odom", self._remember_position, 10)
        self.create_timer(CHECK_PERIOD_S, self._enforce_timeout)

    def _remember_position(self, message):
        position = message.pose.pose.position
        self._odom_position = (position.x, position.y)

    def _relay(self, message):
        self._last_command_s = time.monotonic()
        message.twist.linear.x *= speed_factor_at(DEFAULT_STATE_PATH, *self._odom_position, base=self._base)
        self._publisher.publish(message)

    def _enforce_timeout(self):
        if time.monotonic() - self._last_command_s > COMMAND_TIMEOUT_S:
            stop = TwistStamped()
            stop.header.stamp = self.get_clock().now().to_msg()
            self._publisher.publish(stop)


def main():
    rclpy.init()
    base_text = os.environ.get(ROBOT_BASE_ENV)
    base = tuple(float(part) for part in base_text.split(",")) if base_text else None
    node = CmdVelGuard(os.environ.get(ROBOT_ID_ENV), base)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
