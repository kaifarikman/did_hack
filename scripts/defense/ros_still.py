"""Пассивная ROS-проверка неподвижности после Stop: только подписки, ничего не публикует.

Запускается внутри контейнера simulation демо-стенда (см. stand.sh still):
  python3 ros_still.py [секунды]

Печатает JSON: смещение одометрии за окно, последние команды /agent/cmd_vel и /cmd_vel,
число полученных сообщений. Неподвижность засчитывается, только если сообщения пришли.
"""
import json
import math
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node

STILL_DISPLACEMENT_M = 0.01
ZERO_COMMAND_EPSILON = 1e-6


class StillnessObserver(Node):
    def __init__(self):
        super().__init__('defense_stillness_observer')
        self.odom_positions = []
        self.last_commands = {}
        self.command_counts = {}
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        for topic in ('/agent/cmd_vel', '/cmd_vel'):
            self.create_subscription(TwistStamped, topic, self._command_handler(topic), 10)

    def _on_odom(self, message):
        position = message.pose.pose.position
        self.odom_positions.append((position.x, position.y))

    def _command_handler(self, topic):
        def handle(message):
            self.command_counts[topic] = self.command_counts.get(topic, 0) + 1
            self.last_commands[topic] = {'linear_mps': message.twist.linear.x,
                                         'angular_radps': message.twist.angular.z}
        return handle


def main():
    window_s = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
    rclpy.init()
    observer = StillnessObserver()
    deadline = time.monotonic() + window_s
    while time.monotonic() < deadline:
        rclpy.spin_once(observer, timeout_sec=0.1)
    positions = observer.odom_positions
    displacement_m = (math.dist(positions[0], positions[-1]) if len(positions) >= 2 else None)
    commands_zero = all(abs(command['linear_mps']) < ZERO_COMMAND_EPSILON
                        and abs(command['angular_radps']) < ZERO_COMMAND_EPSILON
                        for command in observer.last_commands.values())
    report = {
        'window_s': window_s,
        'odom_messages': len(positions),
        'odom_start': positions[0] if positions else None,
        'odom_end': positions[-1] if positions else None,
        'displacement_m': displacement_m,
        'command_messages': observer.command_counts,
        'last_commands': observer.last_commands,
        'still': displacement_m is not None and displacement_m < STILL_DISPLACEMENT_M and commands_zero,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    observer.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
