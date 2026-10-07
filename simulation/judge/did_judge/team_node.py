"""ROS 2 узел командного судьи: адресные /<robot>/did/* и общий /did/team_score.

Поза каждого робота берётся из Gazebo (одометрия не используется). Образцы общие, батареи и finish раздельные.
Истинные координаты образцов, зон и расписание не публикуются.
"""
import json
import math
import os

import rclpy
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Float32, String
from std_srvs.srv import Trigger

from .config import JudgeConfig
from .dynamics import generate_event_schedule
from .gazebo_pose import GazeboPoseSource
from .occupancy import load_occupancy_grid
from .ros_node import COLLISION_COOLDOWN_S, COLLISION_RANGE_M, DEFAULT_DATA_DIR
from .scenario import generate_scenario
from .soil_slowdown import DEFAULT_STATE_PATH, write_soil_state
from .team import TeamJudge, default_robot_bases

DEFAULT_ROBOT_IDS = ["robot_1", "robot_2"]


class TeamJudgeNode(Node):
    def __init__(self):
        super().__init__("did_team_judge")
        self.declare_parameter("seed", 0)
        self.declare_parameter("config_path", "")
        self.declare_parameter("map_yaml", os.path.join(DEFAULT_DATA_DIR, "map.yaml"))
        self.declare_parameter("robot_ids", DEFAULT_ROBOT_IDS)
        config_path = self.get_parameter("config_path").value
        self.config = JudgeConfig.from_json_file(config_path) if config_path else JudgeConfig()
        grid = load_occupancy_grid(self.get_parameter("map_yaml").value)
        seed = int(self.get_parameter("seed").value)
        self.robot_ids = list(self.get_parameter("robot_ids").value)
        scenario = generate_scenario(seed, grid, self.config)
        schedule = generate_event_schedule(seed, grid, self.config, scenario) if self.config.dynamic_events else None
        bases = default_robot_bases(self.robot_ids, self.config.base_world_m)
        self.team = TeamJudge(scenario, self.config, bases, schedule)
        self.pose_source = GazeboPoseSource(tuple(self.robot_ids))  # без позы Gazebo командный судья не работает
        self.simulation_time_s = 0.0
        self.last_collision_time_s = {robot_id: -COLLISION_COOLDOWN_S for robot_id in self.robot_ids}
        self.published_events = {robot_id: 0 for robot_id in self.robot_ids}
        self.publishers_by_robot = {}

        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        for robot_id in self.robot_ids:
            self.publishers_by_robot[robot_id] = {
                "battery": self.create_publisher(Float32, f"/{robot_id}/did/battery", 10),
                "sensor": self.create_publisher(Float32, f"/{robot_id}/did/sample_sensor", 10),
                "score": self.create_publisher(String, f"/{robot_id}/did/score", 10),
                "events": self.create_publisher(String, f"/{robot_id}/did/events", 10),
            }
            self.create_subscription(LaserScan, f"/{robot_id}/scan",
                                     lambda message, rid=robot_id: self._on_scan(rid, message), 10)
            self.create_service(Trigger, f"/{robot_id}/did/collect",
                                lambda _request, response, rid=robot_id: self._reply(self.team.collect(rid), response))
            self.create_service(Trigger, f"/{robot_id}/did/finish",
                                lambda _request, response, rid=robot_id: self._reply(self.team.finish(rid), response))
        self.team_score_pub = self.create_publisher(String, "/did/team_score", 10)
        self.create_timer(0.05, self._apply_physical_poses)
        self.create_timer(0.2, self._publish_fast)
        self.create_timer(0.2, self._publish_soil_state)
        self.create_timer(1.0, self._publish_scores)
        self.get_logger().info(f"Командный судья готов: seed={seed} роботы={self.robot_ids} (истина не публикуется)")

    @staticmethod
    def _reply(result, response):
        response.success, response.message = result.success, result.message
        return response

    def _on_clock(self, message):
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _apply_physical_poses(self):
        for robot_id in self.robot_ids:
            pose = self.pose_source.latest_for(robot_id)
            if pose is not None:
                self.team.update_pose(robot_id, pose[0], pose[1], pose[2], self.simulation_time_s)

    def _on_scan(self, robot_id, message):
        finite = [value for value in message.ranges if math.isfinite(value) and value > 0.0]
        too_close = bool(finite) and min(finite) < COLLISION_RANGE_M
        cooled_down = self.simulation_time_s - self.last_collision_time_s[robot_id] >= COLLISION_COOLDOWN_S
        if too_close and cooled_down:
            self.last_collision_time_s[robot_id] = self.simulation_time_s
            self.team.register_collision(robot_id)

    def _publish_fast(self):
        for robot_id in self.robot_ids:
            engine = self.team.engines[robot_id]
            outputs = self.publishers_by_robot[robot_id]
            outputs["battery"].publish(Float32(data=float(engine.battery)))
            if engine.active:
                signal = self.team.sample_signal(robot_id)
                if signal is not None:
                    outputs["sensor"].publish(Float32(data=float(signal)))
            for event in engine.events[self.published_events[robot_id]:]:
                outputs["events"].publish(String(data=json.dumps({
                    "type": event.kind, "robot_id": robot_id,
                    "simulation_time_s": event.simulation_time_s, "battery": event.battery})))
            self.published_events[robot_id] = len(engine.events)

    def _publish_soil_state(self):
        write_soil_state(DEFAULT_STATE_PATH, self.config.base_world_m, self.team.soil_zones(),
                         self.config.soil_speed_factor)

    def _publish_scores(self):
        summary = self.team.team_summary()
        for robot_id, robot_summary in summary["robots"].items():
            self.publishers_by_robot[robot_id]["score"].publish(String(data=json.dumps(
                {"judge_mode": "local", "robot_id": robot_id, **robot_summary,
                 "simulation_time_s": self.simulation_time_s})))
        self.team_score_pub.publish(String(data=json.dumps(
            {"judge_mode": "local", **summary, "simulation_time_s": self.simulation_time_s})))


def main():
    rclpy.init()
    node = TeamJudgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
