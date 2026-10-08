"""Пассивная запись позы и счёта судьи во время демо-прогона: только подписки, ничего не публикует.

Запускается внутри контейнера simulation (см. stand.sh record):
  python3 ros_record.py <секунды> <файл.jsonl>

Каждые 0.5 с пишет строку: время хоста, odom (и мировая поза по формуле ТЗ), последние команды
/agent/cmd_vel и /cmd_vel, последний JSON /did/score. Независимое от backend свидетельство
позы у цели, неподвижности и подтверждения finish.
"""
import json
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String

WORLD_OFFSET = (-2.0, -0.5)  # x_world = -2.0 + odom.x, y_world = -0.5 + odom.y (ТЗ)
SAMPLE_PERIOD_S = 0.5


class DemoRecorder(Node):
    def __init__(self):
        super().__init__('defense_demo_recorder')
        self.odom = None
        self.score = None
        self.commands = {}
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_subscription(String, '/did/score', self._on_score, 10)
        for topic in ('/agent/cmd_vel', '/cmd_vel'):
            self.create_subscription(TwistStamped, topic, self._command_handler(topic), 10)

    def _on_odom(self, message):
        position = message.pose.pose.position
        self.odom = (position.x, position.y)

    def _on_score(self, message):
        try:
            self.score = json.loads(message.data)
        except ValueError:
            self.score = {'unparsed': message.data}

    def _command_handler(self, topic):
        def handle(message):
            self.commands[topic] = [message.twist.linear.x, message.twist.angular.z]
        return handle

    def sample(self):
        world = (None if self.odom is None
                 else [WORLD_OFFSET[0] + self.odom[0], WORLD_OFFSET[1] + self.odom[1]])
        return {'host_time': time.time(), 'odom': self.odom, 'world': world,
                'commands': dict(self.commands), 'score': self.score}


def main():
    duration_s = float(sys.argv[1])
    output_path = sys.argv[2]
    rclpy.init()
    recorder = DemoRecorder()
    deadline = time.monotonic() + duration_s
    next_sample = time.monotonic()
    with open(output_path, 'w') as output:
        while time.monotonic() < deadline:
            rclpy.spin_once(recorder, timeout_sec=0.05)
            if time.monotonic() >= next_sample:
                output.write(json.dumps(recorder.sample(), ensure_ascii=False) + '\n')
                output.flush()
                next_sample += SAMPLE_PERIOD_S
    recorder.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
