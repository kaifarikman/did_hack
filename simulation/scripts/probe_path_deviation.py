"""Inject a bounded localization offset while leaving Gazebo lidar untouched."""
from __future__ import annotations

import copy
import json
import math
import os
import threading
import time
import urllib.request
from pathlib import Path

import rclpy
from gz.msgs10.pose_v_pb2 import Pose_V
from gz.transport13 import Node as GzNode
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan

BACKEND_URL = os.environ.get("T10_BACKEND_URL", "http://backend:8000")
OUTPUT = Path(os.environ.get(
    "T10_PROBE_OUTPUT", "/workspace/simulation/artifacts/t10-path-deviation-probe.json",
))
PHYSICAL_OFFSET_M = 0.60
CONFIRMATION_SECONDS = 0.60
BASE_WORLD = (-2.0, -0.5)


def request_json(path: str, body: dict | None = None) -> dict:
    payload = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BACKEND_URL + path, data=payload,
        headers={"Content-Type": "application/json"} if payload is not None else {},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=2.0) as response:
        return json.load(response)


class DeviationProbe(Node):
    def __init__(self) -> None:
        super().__init__("t10_path_deviation_probe")
        self.latest_odom: Odometry | None = None
        self.latest_scan: LaserScan | None = None
        self.simulation_time_s: float | None = None
        self.physical_pose: tuple[float, float, float] | None = None
        self._injection_thread: threading.Thread | None = None
        self._injection_stop = threading.Event()
        self._injected_pose: tuple[float, float, float] | None = None
        self.odom_publisher = self.create_publisher(Odometry, "/t10/odom", 20)
        self.scan_publisher = self.create_publisher(LaserScan, "/t10/scan", 20)
        self.create_subscription(Odometry, "/odom", self._on_odom, 20)
        self.create_subscription(LaserScan, "/scan", self._on_scan, 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self.gz_node = GzNode()
        if not self.gz_node.subscribe(Pose_V, "/world/default/pose/info", self._on_gazebo_pose):
            raise RuntimeError("cannot subscribe to Gazebo physical pose stream")

    def _on_odom(self, message: Odometry) -> None:
        self.latest_odom = message

    def _on_clock(self, message: Clock) -> None:
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _on_scan(self, message: LaserScan) -> None:
        self.latest_scan = message

    def _on_gazebo_pose(self, message: Pose_V) -> None:
        for entity in message.pose:
            if entity.name == "burger":
                q = entity.orientation
                yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
                p = entity.position
                self.physical_pose = (p.x, p.y, yaw)
                return

    def publish_offset_odom(self, offset_x_m: float, offset_y_m: float) -> None:
        if self.latest_odom is None or self.simulation_time_s is None:
            return
        seconds = int(self.simulation_time_s)
        nanoseconds = int((self.simulation_time_s - seconds) * 1e9)
        message = copy.deepcopy(self.latest_odom)
        message.header.stamp.sec = seconds
        message.header.stamp.nanosec = nanoseconds
        message.pose.pose.position.x += offset_x_m
        message.pose.pose.position.y += offset_y_m
        self.odom_publisher.publish(message)
        self._publish_scan_with_same_world_returns(offset_x_m, offset_y_m)

    def _publish_scan_with_same_world_returns(self, offset_x_m: float, offset_y_m: float) -> None:
        """Re-bin lidar returns so obstacle points stay fixed in world coordinates."""
        if self.latest_scan is None or self.latest_odom is None or self.simulation_time_s is None:
            return
        scan = copy.deepcopy(self.latest_scan)
        seconds = int(self.simulation_time_s)
        scan.header.stamp.sec = seconds
        scan.header.stamp.nanosec = int((self.simulation_time_s - seconds) * 1e9)
        yaw = math.atan2(
            2 * (self.latest_odom.pose.pose.orientation.w * self.latest_odom.pose.pose.orientation.z
                 + self.latest_odom.pose.pose.orientation.x * self.latest_odom.pose.pose.orientation.y),
            1 - 2 * (self.latest_odom.pose.pose.orientation.y ** 2
                     + self.latest_odom.pose.pose.orientation.z ** 2),
        )
        if math.hypot(offset_x_m, offset_y_m) < 1e-6:
            self.scan_publisher.publish(scan)
            return
        offset_robot_x = math.cos(yaw) * offset_x_m + math.sin(yaw) * offset_y_m
        offset_robot_y = -math.sin(yaw) * offset_x_m + math.cos(yaw) * offset_y_m
        output = [float("inf")] * len(scan.ranges)
        for index, distance in enumerate(self.latest_scan.ranges):
            if not math.isfinite(distance) or not self.latest_scan.range_min <= distance <= self.latest_scan.range_max:
                continue
            beam_angle = self.latest_scan.angle_min + index * self.latest_scan.angle_increment
            point_x = distance * math.cos(beam_angle)
            point_y = distance * math.sin(beam_angle)
            relative_x, relative_y = point_x - offset_robot_x, point_y - offset_robot_y
            transformed_angle = math.atan2(relative_y, relative_x)
            transformed_range = math.hypot(relative_x, relative_y)
            target_index = round((transformed_angle - scan.angle_min) / scan.angle_increment)
            if 0 <= target_index < len(output) and transformed_range >= scan.range_min:
                output[target_index] = min(output[target_index], transformed_range)
        scan.ranges = output
        scan.intensities = [0.0] * len(output)
        self.scan_publisher.publish(scan)

    def start_injection(self, offset_x_m: float, offset_y_m: float) -> None:
        self._injected_pose = (offset_x_m, offset_y_m)
        self._injection_stop.clear()

        def publish_loop() -> None:
            while not self._injection_stop.is_set():
                self.publish_offset_odom(*self._injected_pose)
                time.sleep(0.05)

        self._injection_thread = threading.Thread(target=publish_loop, daemon=True)
        self._injection_thread.start()

    def stop_injection(self) -> None:
        self._injection_stop.set()
        if self._injection_thread is not None:
            self._injection_thread.join(timeout=1.0)
            self._injection_thread = None


def lateral_offset(state: dict) -> tuple[float, float, float]:
    path = state["planned_path"]
    pose = state["robot_pose"]
    if not path:
        raise RuntimeError("backend has no planned path")
    start_x, start_y = pose["position_x_m"], pose["position_y_m"]
    end = path[0]
    dx, dy = end["position_x_m"] - start_x, end["position_y_m"] - start_y
    length = math.hypot(dx, dy)
    if length < 1e-6:
        raise RuntimeError("active route segment is too short")
    # Choose the right-hand side of the segment, which moves the base start into the map interior.
    return dy / length * PHYSICAL_OFFSET_M, -dx / length * PHYSICAL_OFFSET_M, length


def journal_titles(run_id: str) -> list[str]:
    page = request_json(f"/api/v1/runs/{run_id}/journal?after_sequence=0&limit=200")
    return [entry.get("title", "") for entry in page.get("entries", [])]


def main() -> None:
    rclpy.init()
    probe = DeviationProbe()
    run_id: str | None = None
    report: dict = {"stack": "isolated didhack-t02", "physical_lateral_offset_m": PHYSICAL_OFFSET_M,
                    "synthetic_scan_published": True}
    token = str(time.time_ns())
    try:
        settle_deadline = time.monotonic() + 3.0
        while time.monotonic() < settle_deadline:
            rclpy.spin_once(probe, timeout_sec=0.05)
        initial = request_json("/api/v1/state")
        if initial.get("status") not in ("idle", "stopped", "failed", "completed"):
            raise RuntimeError(f"backend not idle: {initial.get('status')}")
        if probe.physical_pose is None or probe.latest_odom is None:
            raise RuntimeError("Gazebo pose or odometry is unavailable")

        # The backend uses its isolated /t10/odom input, so keep it live across reset/start.
        probe.start_injection(0.0, 0.0)
        connected_deadline = time.monotonic() + 8.0
        while time.monotonic() < connected_deadline:
            rclpy.spin_once(probe, timeout_sec=0.04)
            health = request_json("/api/v1/health")
            if health.get("ros_connected"):
                break
        else:
            raise RuntimeError("isolated /t10/odom and /t10/scan inputs did not restore backend ROS readiness")
        started = request_json("/api/v1/runs", {
            "request_id": "t10-gazebo-localization-offset-" + token,
            "scenario": "easy", "seed": 23,
            "mission_text": "Исследуй ближайшую область и возвращайся с запасом.",
            "map_mode": "static",
        })
        run_id = started["run_id"]
        deadline = time.monotonic() + 40
        state = started
        while time.monotonic() < deadline:
            rclpy.spin_once(probe, timeout_sec=0.04)
            state = request_json("/api/v1/state")
            if (state.get("run_id") == run_id and state.get("status") == "running"
                    and state.get("planned_path") and probe.physical_pose is not None):
                break
        else:
            raise RuntimeError("run did not expose an active route")

        offset_x, offset_y, segment_length = lateral_offset(state)
        probe.stop_injection()
        physical_before = probe.physical_pose
        physical_gap = math.dist((state["robot_pose"]["position_x_m"], state["robot_pose"]["position_y_m"]),
                                 physical_before[:2])
        route_revision_before, plan_revision_before = state["route_revision"], state["plan_revision"]
        report.update({
            "run_id": run_id, "route_revision_before": route_revision_before,
            "plan_revision_before": plan_revision_before, "active_segment_length_m": round(segment_length, 4),
            "physical_pose_before_offset": list(physical_before),
            "backend_to_physical_pose_gap_before_m": round(physical_gap, 4),
            "injected_odom_offset_xy_m": [round(offset_x, 4), round(offset_y, 4)],
            "backend_odom_input_topic": "/t10/odom",
            "backend_scan_input_topic": "/t10/scan",
            "lidar_returns_reprojected_to_preserve_world_points": True,
        })

        probe.start_injection(offset_x, offset_y)
        started_at = time.monotonic()
        samples: list[dict] = []
        titles: list[str] = []
        while time.monotonic() - started_at < 3.0:
            rclpy.spin_once(probe, timeout_sec=0.03)
            state = request_json("/api/v1/state")
            titles = journal_titles(run_id)
            samples.append({"elapsed_s": round(time.monotonic() - started_at, 3),
                            "status": state.get("status"), "route_revision": state.get("route_revision"),
                            "plan_revision": state.get("plan_revision"), "robot_pose": state.get("robot_pose")})
            if "Перепланирование после отклонения" in titles:
                break
        probe.stop_injection()
        replan_seen = "Перепланирование после отклонения" in titles
        report.update({"deviation_replan_journaled": replan_seen, "journal_titles": titles,
                       "route_revision_after_offset": state.get("route_revision"),
                       "plan_revision_after_offset": state.get("plan_revision"),
                       "goal_after_offset": state.get("current_goal"), "offset_samples": samples})

        probe.stop_injection()
        first_replan_count = titles.count("Перепланирование после отклонения")
        cooldown_started = time.monotonic()
        cooldown_samples: list[dict] = []
        probe.start_injection(-offset_x, -offset_y)
        while time.monotonic() - cooldown_started < 1.0:
            rclpy.spin_once(probe, timeout_sec=0.03)
            state = request_json("/api/v1/state")
            titles = journal_titles(run_id)
            cooldown_samples.append({"elapsed_s": round(time.monotonic() - cooldown_started, 3),
                                     "status": state.get("status"),
                                     "route_revision": state.get("route_revision"),
                                     "current_goal": state.get("current_goal")})
        probe.stop_injection()
        cooldown_replan_count = titles.count("Перепланирование после отклонения")
        report.update({"cooldown_window_s": round(time.monotonic() - cooldown_started, 3),
                       "replan_count_before_cooldown_probe": first_replan_count,
                       "replan_count_during_cooldown_probe": cooldown_replan_count,
                       "second_deviation_suppressed_during_cooldown":
                           replan_seen and cooldown_replan_count == first_replan_count,
                       "cooldown_probe_samples": cooldown_samples,
                       "goal_after_cooldown_probe": state.get("current_goal")})

        # Remove the localization offset and confirm that the controller's new route remains valid.
        probe.start_injection(0.0, 0.0)
        recovery_started = time.monotonic()
        recovery_samples: list[dict] = []
        while time.monotonic() - recovery_started < 1.0:
            rclpy.spin_once(probe, timeout_sec=0.04)
            state = request_json("/api/v1/state")
            recovery_samples.append({"elapsed_s": round(time.monotonic() - recovery_started, 3),
                                     "status": state.get("status"), "route_revision": state.get("route_revision"),
                                     "robot_pose": state.get("robot_pose")})
        probe.stop_injection()
        titles = journal_titles(run_id)
        physical_after = probe.physical_pose
        report.update({"journal_after_offset_removed": titles,
                       "extra_replan_during_one_second_after_offset_removed":
                           titles.count("Перепланирование после отклонения") > int(replan_seen),
                       "physical_pose_after_probe": list(physical_after) if physical_after else None,
                       "physical_robot_drift_during_probe_m":
                           round(math.dist(physical_before[:2], physical_after[:2]), 4)
                           if physical_after else None,
                       "recovery_samples": recovery_samples})
        request_json(f"/api/v1/runs/{run_id}/stop", {"request_id": "t10-stop-" + token})
        report["stop_requested"] = True
    finally:
        probe.stop_injection()
        if run_id:
            try:
                state = request_json("/api/v1/state")
                if state.get("run_id") == run_id and state.get("status") not in (
                        "failed", "completed", "stopped"):
                    request_json(f"/api/v1/runs/{run_id}/stop", {"request_id": "t10-final-stop-" + token})
            except Exception as error:
                report["cleanup_error"] = str(error)
        if rclpy.ok():
            rclpy.shutdown()
        probe.destroy_node()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report.get("deviation_replan_journaled"):
        raise AssertionError("Gazebo-backed odometry offset did not trigger a sustained-deviation replan")
    if not report.get("second_deviation_suppressed_during_cooldown"):
        raise AssertionError("a second lateral deviation was not suppressed during the cooldown window")


if __name__ == "__main__":
    main()
