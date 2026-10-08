"""Inject one physical Gazebo obstacle after the backend begins linear motion.

Run only against the isolated DID test stack. The node never publishes velocity;
it records commands and observes whether the backend pauses/replans before contact.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from ros_gz_interfaces.msg import Contacts
from sensor_msgs.msg import LaserScan
from rclpy.node import Node
from std_msgs.msg import String
from rclpy.qos import qos_profile_sensor_data

JUDGE_DIR = Path(__file__).resolve().parents[1] / "judge"
sys.path.insert(0, str(JUDGE_DIR))
from did_judge.contacts import has_obstacle_contact  # noqa: E402
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402

OUTPUT = Path(os.environ.get("T09_PROBE_OUTPUT", "/workspace/simulation/artifacts/t09-dynamic-obstacle-probe.json"))
BACKEND_URL = os.environ.get("T09_BACKEND_URL", "http://backend:8000")
TRIGGER_LINEAR_MPS = 0.05
OBSTACLE_DISTANCE_M = 0.65
ODOM_TO_WORLD_X_M = -2.0
ODOM_TO_WORLD_Y_M = -0.5


class DynamicObstacleProbe(Node):
    def __init__(self) -> None:
        super().__init__("t09_dynamic_obstacle_probe")
        self._lock = threading.Lock()
        self._pose: tuple[float, float, float] | None = None
        self._physical_pose = GazeboPoseSource()
        self._inserted = False
        self._run_id: str | None = None
        self._started_s = time.monotonic()
        self._commands: list[dict] = []
        self._states: list[dict] = []
        self._create_result: str | None = None
        self._stop_seen = False
        self._collision_events: list[dict] = []
        self._physical_contacts: list[dict] = []
        self._minimum_physical_clearance_m: float | None = None
        self._closest_physical_sample: dict | None = None
        self._first_zero_after_insertion_s: float | None = None
        self._obstacle_world_position: tuple[float, float] | None = None
        self._obstacle_inserted_at_s: float | None = None
        self._obstacle_removed_at_s: float | None = None
        self._obstacle_remove_result: str | None = None
        self._remove_after_s = float(os.environ.get("T09_REMOVE_AFTER_S", "8"))
        self._scan_frames: list[dict] = []
        self._last_state_sample_s = 0.0
        self._last_state_key: tuple | None = None
        self.create_subscription(Odometry, "/odom", self._on_odom, qos_profile_sensor_data)
        self.create_subscription(LaserScan, "/scan", self._on_scan, qos_profile_sensor_data)
        self.create_subscription(TwistStamped, "/cmd_vel", self._on_command, 20)
        self.create_subscription(String, "/did/events", self._on_event, 20)
        self.create_subscription(
            Contacts,
            "/world/default/model/burger/link/base_link/sensor/base_contact/contact",
            self._on_contact,
            qos_profile_sensor_data,
        )
        self.create_timer(0.1, self._sample_backend)
        self.create_timer(0.025, self._sample_physical_clearance)
        self.get_logger().info("Waiting for first forward command to insert test obstacle")

    def _on_odom(self, message: Odometry) -> None:
        p = message.pose.pose.position
        q = message.pose.pose.orientation
        yaw = math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))
        with self._lock:
            self._pose = (p.x, p.y, yaw)

    def _on_scan(self, message: LaserScan) -> None:
        with self._lock:
            pose = self._pose
        if pose is None:
            return
        odom_x, odom_y, yaw = pose
        points = []
        max_range_m = min(float(message.range_max), 4.0)
        for index in range(0, len(message.ranges), 4):
            distance = float(message.ranges[index])
            if not math.isfinite(distance) or not message.range_min <= distance <= max_range_m:
                continue
            angle = yaw + message.angle_min + index * message.angle_increment
            points.append([
                round(ODOM_TO_WORLD_X_M + odom_x + distance * math.cos(angle), 3),
                round(ODOM_TO_WORLD_Y_M + odom_y + distance * math.sin(angle), 3),
            ])
        self._scan_frames.append({"elapsed_s": round(time.monotonic() - self._started_s, 3), "points_world": points})

    def _on_command(self, message: TwistStamped) -> None:
        command = message.twist
        now = time.monotonic()
        with self._lock:
            pose = self._pose
            self._commands.append({"elapsed_s": round(now - self._started_s, 3),
                                   "linear_mps": command.linear.x,
                                   "angular_radps": command.angular.z,
                                   "pose": list(pose) if pose else None})
            if self._inserted and self._first_zero_after_insertion_s is None \
                    and abs(command.linear.x) < 1e-5 and abs(command.angular.z) < 1e-5:
                self._first_zero_after_insertion_s = round(now - self._started_s, 3)
            should_insert = (not self._inserted and pose is not None
                             and command.linear.x >= TRIGGER_LINEAR_MPS)
            if should_insert:
                self._inserted = True
        if should_insert:
            self._insert_at(pose, command.linear.x)

    def _insert_at(self, pose: tuple[float, float, float], linear_mps: float) -> None:
        x, y, yaw = pose
        if linear_mps < 0:
            yaw += math.pi
        obstacle_x = ODOM_TO_WORLD_X_M + x + OBSTACLE_DISTANCE_M * math.cos(yaw)
        obstacle_y = ODOM_TO_WORLD_Y_M + y + OBSTACLE_DISTANCE_M * math.sin(yaw)
        self._obstacle_world_position = (obstacle_x, obstacle_y)
        self._obstacle_inserted_at_s = time.monotonic() - self._started_s
        sdf = '''<?xml version="1.0"?>
<sdf version="1.9"><model name="t09_live_block"><static>true</static><link name="body">
<collision name="collision"><geometry><box><size>0.32 0.32 0.50</size></box></geometry></collision>
<visual name="visual"><geometry><box><size>0.32 0.32 0.50</size></box></geometry></visual>
</link></model></sdf>'''
        sdf_path = Path("/tmp/t09-live-block.sdf")
        sdf_path.write_text(sdf)
        request = (f'sdf_filename: "{sdf_path}", name: "t09_live_block", '
                   f'pose: {{position: {{x: {obstacle_x:.5f}, y: {obstacle_y:.5f}, z: 0.25}}}}')
        result = subprocess.run(
            ["gz", "service", "-s", "/world/default/create", "--reqtype", "gz.msgs.EntityFactory",
             "--reptype", "gz.msgs.Boolean", "--timeout", "4000", "--req", request],
            capture_output=True, text=True, timeout=6, check=False,
        )
        self._create_result = (result.stdout + result.stderr).strip()
        self.get_logger().info(f"Inserted physical obstacle at ({obstacle_x:.3f}, {obstacle_y:.3f}): {self._create_result}")

    def _on_event(self, message: String) -> None:
        try:
            event = json.loads(message.data)
        except (json.JSONDecodeError, TypeError):
            return
        if event.get("type") == "collision":
            self._collision_events.append(event)

    def _on_contact(self, message: Contacts) -> None:
        if self._obstacle_inserted_at_s is None or not has_obstacle_contact(message, "burger"):
            return
        for contact in message.contacts:
            pair = (contact.collision1.name, contact.collision2.name)
            if any(name.startswith("t09_live_block::") for name in pair):
                self._physical_contacts.append({
                    "elapsed_s": round(time.monotonic() - self._started_s, 3),
                    "collision1": pair[0],
                    "collision2": pair[1],
                })

    def _sample_physical_clearance(self) -> None:
        if self._obstacle_world_position is None or self._obstacle_inserted_at_s is None:
            return
        now = time.monotonic()
        if self._obstacle_removed_at_s is not None:
            return
        pose = self._physical_pose.latest()
        if pose is None:
            return
        obstacle_x, obstacle_y = self._obstacle_world_position
        half_box = 0.16
        gap_x = max(abs(pose[0] - obstacle_x) - half_box, 0.0)
        gap_y = max(abs(pose[1] - obstacle_y) - half_box, 0.0)
        clearance = math.hypot(gap_x, gap_y)
        if self._minimum_physical_clearance_m is None or clearance < self._minimum_physical_clearance_m:
            self._minimum_physical_clearance_m = clearance
            self._closest_physical_sample = {
                "elapsed_s": round(now - self._started_s, 3),
                "robot_pose_world": list(pose),
                "box_center_world": [obstacle_x, obstacle_y],
                "center_to_box_edge_m": round(clearance, 4),
            }

    def _remove_obstacle_if_due(self) -> None:
        if (not self._inserted or self._obstacle_removed_at_s is not None
                or self._obstacle_inserted_at_s is None
                or time.monotonic() - self._started_s - self._obstacle_inserted_at_s < self._remove_after_s):
            return
        result = subprocess.run(
            ["gz", "service", "-s", "/world/default/remove", "--reqtype", "gz.msgs.Entity",
             "--reptype", "gz.msgs.Boolean", "--timeout", "4000", "--req",
             'name: "t09_live_block", type: MODEL'],
            capture_output=True, text=True, timeout=6, check=False,
        )
        self._obstacle_remove_result = (result.stdout + result.stderr).strip()
        self._obstacle_removed_at_s = time.monotonic() - self._started_s
        self.get_logger().info(f"Removed test obstacle: {self._obstacle_remove_result}")

    def _sample_backend(self) -> None:
        self._remove_obstacle_if_due()
        try:
            with urllib.request.urlopen(BACKEND_URL + "/api/v1/state", timeout=0.5) as response:
                state = json.load(response)
            if state.get("run_id"):
                self._run_id = state["run_id"]
            now = time.monotonic()
            current_goal = state.get("current_goal")
            key = (state.get("status"), state.get("route_revision"), state.get("plan_revision"),
                   current_goal.get("kind") if current_goal else None,
                   tuple(current_goal.get("target", {}).values()) if current_goal else None)
            if key != self._last_state_key or now - self._last_state_sample_s >= 1.0:
                self._states.append({
                    "elapsed_s": round(now - self._started_s, 3),
                    "run_id": state.get("run_id"), "status": state.get("status"),
                    "pose": state.get("robot_pose"), "current_goal": current_goal,
                    "planned_path": state.get("planned_path"), "route_revision": state.get("route_revision"),
                    "plan_revision": state.get("plan_revision"), "last_error": state.get("last_error"),
                })
                self._last_state_key, self._last_state_sample_s = key, now
            if state.get("status") in ("failed", "completed", "stopped") and self._inserted:
                self._write_report()
                rclpy.shutdown()
        except Exception:
            pass

    def _write_report(self) -> None:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "run_id": self._run_id,
            "insertion_result": self._create_result,
            "obstacle_distance_m": OBSTACLE_DISTANCE_M,
            "obstacle_world_position": self._obstacle_world_position,
            "obstacle_inserted_at_s": self._obstacle_inserted_at_s,
            "obstacle_removed_at_s": self._obstacle_removed_at_s,
            "obstacle_remove_result": self._obstacle_remove_result,
            "remove_after_s": self._remove_after_s,
            "odom_to_world_offset_m": [ODOM_TO_WORLD_X_M, ODOM_TO_WORLD_Y_M],
            "commands": self._commands,
            "scan_frames": self._scan_frames,
            "states": self._states,
            "collision_events": self._collision_events,
            "physical_contacts_with_test_box": self._physical_contacts,
            "minimum_physical_center_to_box_edge_m": self._minimum_physical_clearance_m,
            "closest_physical_clearance_sample": self._closest_physical_sample,
            "robot_radius_m": 0.11,
            "first_zero_after_insertion_s": self._first_zero_after_insertion_s,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    rclpy.init()
    node = DynamicObstacleProbe()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        if rclpy.ok():
            node._write_report()
            rclpy.shutdown()
        node.destroy_node()


if __name__ == "__main__":
    main()
