"""Проба командной миссии в Gazebo: оба робота едут к одному образцу, собирают, возвращаются, завершают.

Подготовка: python3 scripts/stack.py up --robots 2 --scenario easy --seed 1  (seed из find_shared_sample_seed.py).
Запуск в контейнере: source /opt/ros/jazzy/setup.bash && GZ_PARTITION=did python3 .../probe_team_collect.py
Позиция образца берётся из генератора судьи (истина только для пробы). Робот_1 приезжает вплотную, робот_2
останавливается рядом (в радиусе сбора), поэтому его сбор должен быть отклонён: образец засчитывается один раз.
Управление — go-to-point по физической позе Gazebo; код выхода 1, если проверка не прошла.
"""
import json
import math
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from rclpy.node import Node
from std_msgs.msg import String
from std_srvs.srv import Trigger

SIMULATION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "judge"))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "scripts"))
from did_judge.config import JudgeConfig  # noqa: E402
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from did_judge.scenario import generate_scenario  # noqa: E402
from robot_model import default_bases  # noqa: E402

ROBOTS = ("robot_1", "robot_2")
SCENARIO, SEED = os.environ.get("PROBE_SCENARIO", "easy"), int(os.environ.get("PROBE_SEED", "1"))
SPEED_M_S, TURN_GAIN, ROTATE_ONLY_ABOVE_RAD = 0.15, 1.5, 0.5
STOP_DISTANCE_M = {"robot_1": 0.05, "robot_2": 0.26}


class Mission(Node):
    def __init__(self):
        super().__init__("team_collect_probe")
        self.truth = GazeboPoseSource(ROBOTS)
        self.team_score = None
        self.command_publishers = {r: self.create_publisher(TwistStamped, f"/{r}/agent/cmd_vel", 10) for r in ROBOTS}
        self.trigger_clients = {(r, name): self.create_client(Trigger, f"/{r}/did/{name}")
                        for r in ROBOTS for name in ("collect", "finish")}
        self.create_subscription(String, "/did/team_score", lambda m: setattr(self, "team_score", json.loads(m.data)), 10)

    def step_towards(self, robot, target, stop_distance):
        pose = self.truth.latest_for(robot)
        if pose is None:
            return False
        distance = math.dist(pose[:2], target)
        command = TwistStamped()
        if distance > stop_distance:
            error = math.atan2(target[1] - pose[1], target[0] - pose[0]) - pose[2]
            error = math.atan2(math.sin(error), math.cos(error))
            command.twist.angular.z = max(-1.0, min(1.0, TURN_GAIN * error))
            command.twist.linear.x = 0.0 if abs(error) > ROTATE_ONLY_ABOVE_RAD else SPEED_M_S
        self.command_publishers[robot].publish(command)
        return distance <= stop_distance

    def go(self, targets, timeout_s=90.0):
        """targets: {robot: (point, stop_distance)}; едут одновременно, возвращает robot -> достиг ли."""
        reached = {robot: False for robot in targets}
        end = time.monotonic() + timeout_s
        while time.monotonic() < end and not all(reached.values()):
            for robot, (point, stop) in targets.items():
                if not reached[robot]:
                    reached[robot] = self.step_towards(robot, point, stop)
            rclpy.spin_once(self, timeout_sec=0.05)
        for robot in ROBOTS:
            self.command_publishers[robot].publish(TwistStamped())
        return reached

    def call(self, robot, name):
        future = self.trigger_clients[(robot, name)].call_async(Trigger.Request())
        rclpy.spin_until_future_complete(self, future, timeout_sec=5.0)
        return future.result()

    def settle(self, seconds=2.5):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            rclpy.spin_once(self, timeout_sec=0.05)


def main():
    config = JudgeConfig.from_json_file(os.path.join(SIMULATION_DIR, "judge", "config", f"local_{SCENARIO}.json"))
    grid = load_occupancy_grid(os.path.join(SIMULATION_DIR, "judge", "data", "map.yaml"))
    sample = generate_scenario(SEED, grid, config).samples[0]
    target = min(generate_scenario(SEED, grid, config).samples, key=lambda point: math.dist(point, config.base_world_m))
    bases = default_bases(2)
    rclpy.init()
    mission = Mission()
    mission.settle(3.0)
    checks = {}

    reached = mission.go({"robot_1": (target, STOP_DISTANCE_M["robot_1"])})
    checks["robot_1_reached_sample"] = reached["robot_1"]
    reached = mission.go({"robot_2": (target, STOP_DISTANCE_M["robot_2"])})
    checks["robot_2_reached_sample_vicinity"] = reached["robot_2"]
    first, second = mission.call("robot_1", "collect"), mission.call("robot_2", "collect")
    mission.settle()
    checks["first_collect_succeeds"] = bool(first and first.success)
    checks["second_collect_rejected"] = bool(second and not second.success)
    checks["sample_credited_once"] = mission.team_score["team_collected"] == 1

    mission_back = mission.go({robot: (bases[robot], 0.15) for robot in ROBOTS}, timeout_s=120.0)
    checks["both_returned"] = all(mission_back.values())
    finishes = {robot: mission.call(robot, "finish") for robot in ROBOTS}
    mission.settle()
    checks["both_finish_ok"] = all(reply and reply.success for reply in finishes.values())
    summary = mission.team_score
    checks["individual_results_reported"] = all(robot in summary["robots"] for robot in ROBOTS)

    print(json.dumps({"checks": checks, "sample": [round(v, 2) for v in target], "team_score": summary},
                     ensure_ascii=False, indent=1))
    rclpy.shutdown()
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
