"""Проба командного режима (после reset с robots=2): адресность, раздельные батареи, потеря команд, столкновение.

Запуск внутри контейнера simulation:
  source /opt/ros/jazzy/setup.bash && GZ_PARTITION=did python3 /workspace/simulation/scripts/probe_team.py
Печатает JSON-отчёт проверок; код выхода 1, если какая-то проверка не прошла.
"""
import json
import math
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import Float32, String
from std_srvs.srv import Trigger

ROBOTS = ("robot_1", "robot_2")


class TeamProbe(Node):
    def __init__(self):
        super().__init__("team_probe")
        self.battery = {robot: None for robot in ROBOTS}
        self.odom = {robot: None for robot in ROBOTS}
        self.events = {robot: [] for robot in ROBOTS}
        self.team_score = None
        self.command_publishers = {}
        self.collect_clients = {}
        for robot in ROBOTS:
            self.command_publishers[robot] = self.create_publisher(TwistStamped, f"/{robot}/agent/cmd_vel", 10)
            self.collect_clients[robot] = self.create_client(Trigger, f"/{robot}/did/collect")
            self.create_subscription(Float32, f"/{robot}/did/battery",
                                     lambda m, r=robot: self.battery.__setitem__(r, m.data), 10)
            self.create_subscription(Odometry, f"/{robot}/odom", lambda m, r=robot: self.odom.__setitem__(
                r, (m.pose.pose.position.x, m.pose.pose.position.y)), 10)
            self.create_subscription(String, f"/{robot}/did/events",
                                     lambda m, r=robot: self.events[r].append(json.loads(m.data)), 10)
        self.create_subscription(String, "/did/team_score", self._on_team_score, 10)

    def _on_team_score(self, message):
        self.team_score = json.loads(message.data)

    def run_for(self, seconds, commands=None, stop_when=None):
        """commands: {robot: (linear, angular)}; роботы вне словаря не получают команд (тишина)."""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            for robot, (linear, angular) in (commands or {}).items():
                command = TwistStamped()
                command.twist.linear.x, command.twist.angular.z = linear, angular
                self.command_publishers[robot].publish(command)
            rclpy.spin_once(self, timeout_sec=0.05)
            if stop_when and stop_when():
                return

    def call_collect(self, robot):
        future = self.collect_clients[robot].call_async(Trigger.Request())
        rclpy.spin_until_future_complete(self, future, timeout_sec=5.0)
        return future.result()


def move(start, end):
    return math.dist(start, end)


def main():
    rclpy.init()
    probe = TeamProbe()
    checks = {}
    probe.run_for(3.0)
    checks["topics_present"] = all(probe.battery[robot] is not None and probe.odom[robot] is not None
                                   for robot in ROBOTS) and probe.team_score is not None

    # 1. Команда только robot_1: расход и движение только у него
    battery_before, odom_before = dict(probe.battery), dict(probe.odom)
    probe.run_for(5.0, {"robot_1": (0.1, 0.0)})
    probe.run_for(1.0)
    spent = {robot: battery_before[robot] - probe.battery[robot] for robot in ROBOTS}
    checks["commands_are_addressed"] = (move(odom_before["robot_1"], probe.odom["robot_1"]) > 0.4
                                        and move(odom_before["robot_2"], probe.odom["robot_2"]) < 0.02)
    checks["batteries_are_independent"] = spent["robot_1"] > 0.3 and spent["robot_2"] < 0.02

    # 2. Ложный collect у каждого штрафуется отдельно; общий счёт не прячет оба отказа
    replies = {robot: probe.call_collect(robot) for robot in ROBOTS}
    probe.run_for(2.5)
    robots_summary = probe.team_score["robots"]
    checks["false_collects_per_robot"] = (not replies["robot_1"].success and not replies["robot_2"].success
                                          and all(robots_summary[robot]["false_collects"] == 1 for robot in ROBOTS))
    checks["team_has_no_double_credit"] = probe.team_score["team_collected"] == 0

    # 3. Потеря источника команд у robot_2: robot_1 продолжает ехать, robot_2 останавливается
    probe.run_for(2.0, {"robot_1": (0.05, 0.0), "robot_2": (0.1, 0.0)})
    robot_2_before_silence = probe.odom["robot_2"]
    robot_1_before = probe.odom["robot_1"]
    probe.run_for(1.0, {"robot_1": (0.05, 0.0)})  # robot_2 больше не получает команд; страж ждёт 0.5 с
    robot_2_stop_point = probe.odom["robot_2"]
    probe.run_for(3.0, {"robot_1": (0.05, 0.0)})
    checks["silent_robot_stops"] = move(robot_2_stop_point, probe.odom["robot_2"]) < 0.02
    checks["other_robot_keeps_moving"] = move(robot_1_before, probe.odom["robot_1"]) > 0.1
    checks["silent_robot_stopped_within_limit"] = move(robot_2_before_silence, robot_2_stop_point) < 0.08

    # 4. Встречное движение: robot_1 поворачивает к robot_2 и едет до столкновения
    probe.run_for(2.0)
    probe.run_for(6.0, {"robot_1": (0.0, 0.5)})  # ~3 рад — разворот в сторону, где стоит robot_2 (север)
    events_before = len(probe.events["robot_1"])
    probe.run_for(20.0, {"robot_1": (0.1, 0.0)},
                  stop_when=lambda: any(e["type"] == "collision" for e in probe.events["robot_1"][events_before:]))
    probe.run_for(1.0)
    checks["collision_registered_for_driver"] = any(
        event["type"] == "collision" for event in probe.events["robot_1"][events_before:])

    print(json.dumps({"checks": checks, "battery_spent_phase1": spent,
                      "team_score": probe.team_score}, ensure_ascii=False, indent=1))
    rclpy.shutdown()
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
