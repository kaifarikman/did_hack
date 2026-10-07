"""Адаптер ROS 2: публикует /did/* и принимает вызовы сбора/завершения.

Истинные координаты образцов и зон остаются внутри процесса: наружу уходят
только батарея, шумный сигнал, события и счёт.
"""
import json
import math
import os

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Float32, String
from std_srvs.srv import Trigger

from .config import JudgeConfig
from .engine import JudgeEngine
from .occupancy import load_occupancy_grid
from .dynamics import generate_event_schedule
from .scenario import generate_scenario

DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
COLLISION_RANGE_M = 0.14  # лидар Burger стоит у центра; радиус корпуса ~0.105 м
COLLISION_COOLDOWN_S = 2.0


def yaw_of(orientation) -> float:
    return math.atan2(2.0 * (orientation.w * orientation.z + orientation.x * orientation.y),
                      1.0 - 2.0 * (orientation.y ** 2 + orientation.z ** 2))


class JudgeNode(Node):
    def __init__(self):
        super().__init__("did_judge")
        self.declare_parameter("seed", 0)
        self.declare_parameter("config_path", "")
        self.declare_parameter("map_yaml", os.path.join(DEFAULT_DATA_DIR, "map.yaml"))
        config_path = self.get_parameter("config_path").value
        self.config = JudgeConfig.from_json_file(config_path) if config_path else JudgeConfig()
        grid = load_occupancy_grid(self.get_parameter("map_yaml").value)
        seed = int(self.get_parameter("seed").value)
        scenario = generate_scenario(seed, grid, self.config)
        schedule = generate_event_schedule(seed, grid, self.config, scenario) if self.config.dynamic_events else None
        self.engine = JudgeEngine(scenario, self.config, schedule=schedule)
        self.simulation_time_s = 0.0
        self.last_collision_time_s = -COLLISION_COOLDOWN_S
        self.published_events = 0

        self.battery_pub = self.create_publisher(Float32, "/did/battery", 10)
        self.sensor_pub = self.create_publisher(Float32, "/did/sample_sensor", 10)
        self.score_pub = self.create_publisher(String, "/did/score", 10)
        self.events_pub = self.create_publisher(String, "/did/events", 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self.create_subscription(LaserScan, "/scan", self._on_scan, 10)
        self.create_service(Trigger, "/did/collect", self._on_collect)
        self.create_service(Trigger, "/did/finish", self._on_finish)
        self.create_timer(0.2, self._publish_fast)
        self.create_timer(1.0, self._publish_score)
        self.get_logger().info(f"Судья local готов: seed={seed} (истина не публикуется)")

    def _on_clock(self, message):
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _on_odom(self, message):
        position = message.pose.pose.position
        base_x, base_y = self.config.base_world_m
        self.engine.update_pose(base_x + position.x, base_y + position.y,
                                yaw_of(message.pose.pose.orientation), self.simulation_time_s)

    def _on_scan(self, message):
        finite = [value for value in message.ranges if math.isfinite(value) and value > 0.0]
        too_close = bool(finite) and min(finite) < COLLISION_RANGE_M
        cooled_down = self.simulation_time_s - self.last_collision_time_s >= COLLISION_COOLDOWN_S
        if too_close and cooled_down:
            self.last_collision_time_s = self.simulation_time_s
            self.engine.register_collision()

    def _on_collect(self, _request, response):
        result = self.engine.collect()
        response.success, response.message = result.success, result.message
        return response

    def _on_finish(self, _request, response):
        result = self.engine.finish()
        response.success, response.message = result.success, result.message
        return response

    def _publish_fast(self):
        self.battery_pub.publish(Float32(data=float(self.engine.battery)))
        if self.engine.active:
            signal = self.engine.sample_signal()
            if signal is not None:
                self.sensor_pub.publish(Float32(data=float(signal)))
        for event in self.engine.events[self.published_events:]:
            self.events_pub.publish(String(data=json.dumps({
                "type": event.kind,
                "simulation_time_s": event.simulation_time_s,
                "battery": event.battery,
            })))
        self.published_events = len(self.engine.events)

    def _publish_score(self):
        engine = self.engine
        self.score_pub.publish(String(data=json.dumps({
            "judge_mode": "local",
            "state": engine.state_label(),
            "score": engine.score(),
            "collected": engine.collected,
            "collisions": engine.collisions,
            "false_collects": engine.false_collects,
            "finished": engine.finished,
            "finish_success": engine.finish_success,
            "battery": engine.battery,
            "simulation_time_s": engine.simulation_time_s,
        })))


def main():
    rclpy.init()
    node = JudgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
