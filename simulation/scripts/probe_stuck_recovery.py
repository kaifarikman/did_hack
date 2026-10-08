"""Controlled Gazebo check for the backend's bounded reverse/turn recovery sequence."""
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
from geometry_msgs.msg import TwistStamped
from gz.msgs10.pose_v_pb2 import Pose_V
from gz.transport13 import Node as GzNode
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String

BACKEND_URL = os.environ.get("T12_BACKEND_URL", "http://backend:8000")
OUTPUT = Path(os.environ.get(
    "T12_PROBE_OUTPUT", "/workspace/simulation/artifacts/t12-stuck-recovery-probe.json",
))
BASE_WORLD = (-2.0, -0.5)
ODOM_TOPIC = "/t12/odom"
SCAN_TOPIC = "/t12/scan"
PUBLISH_PERIOD_S = 0.05
SEED = int(os.environ.get("T12_SEED", "23"))


def request_json(path: str, body: dict | None = None) -> dict:
    payload = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BACKEND_URL + path, data=payload,
        headers={"Content-Type": "application/json"} if payload is not None else {},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=3.0) as response:
        return json.load(response)


class RecoveryProbe(Node):
    def __init__(self) -> None:
        super().__init__("t12_stuck_recovery_probe")
        self.latest_odom: Odometry | None = None
        self.latest_scan: LaserScan | None = None
        self.simulation_time_s: float | None = None
        self.physical_pose: tuple[float, float, float] | None = None
        self.latest_command = (0.0, 0.0)
        self.latest_telemetry: str | None = None
        self.generation: int | None = None
        self.mode = "relay"
        self.synthetic_pose: tuple[float, float, float] | None = None
        self.anchor_pose: tuple[float, float, float] | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_integrated_at = time.monotonic()
        self.commands: list[dict] = []
        self.odom_publisher = self.create_publisher(Odometry, ODOM_TOPIC, 20)
        self.scan_publisher = self.create_publisher(LaserScan, SCAN_TOPIC, 20)
        self.native_scan_publisher = self.create_publisher(LaserScan, "/scan", 20)
        self.telemetry_publisher = self.create_publisher(String, "/did/telemetry", 20)
        self.create_subscription(Odometry, "/odom", self._on_odom, 20)
        self.create_subscription(LaserScan, "/scan", self._on_scan, 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self.create_subscription(String, "/did/telemetry", self._on_telemetry, 20)
        self.create_subscription(TwistStamped, "/agent/cmd_vel", self._on_command, 20)
        self.gz_node = GzNode()
        if not self.gz_node.subscribe(Pose_V, "/world/default/pose/info", self._on_gazebo_pose):
            raise RuntimeError("cannot subscribe to Gazebo physical pose stream")

    def _on_odom(self, message: Odometry) -> None:
        self.latest_odom = message

    def _on_scan(self, message: LaserScan) -> None:
        self.latest_scan = message

    def _on_clock(self, message: Clock) -> None:
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _on_telemetry(self, message: String) -> None:
        try:
            telemetry = json.loads(message.data)
        except (json.JSONDecodeError, TypeError):
            return
        if not isinstance(telemetry, dict) or telemetry.get("robot_id") != "robot_1":
            return
        self.latest_telemetry = message.data

    def _on_command(self, message: TwistStamped) -> None:
        command = (float(message.twist.linear.x), float(message.twist.angular.z))
        self.latest_command = command
        physical = self.physical_pose
        self.commands.append({"time_s": round(time.monotonic(), 3), "linear_mps": command[0],
                              "angular_radps": command[1], "physical_pose": list(physical) if physical else None})

    def _on_gazebo_pose(self, message: Pose_V) -> None:
        for entity in message.pose:
            if entity.name == "burger":
                p, q = entity.position, entity.orientation
                yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
                self.physical_pose = (p.x, p.y, yaw)
                return

    @staticmethod
    def _yaw(message: Odometry) -> float:
        q = message.pose.pose.orientation
        return math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))

    def _actual_world_pose(self) -> tuple[float, float, float] | None:
        if self.latest_odom is None:
            return None
        p = self.latest_odom.pose.pose.position
        return BASE_WORLD[0] + p.x, BASE_WORLD[1] + p.y, self._yaw(self.latest_odom)

    def _pose_for_publish(self) -> tuple[float, float, float] | None:
        with self._lock:
            mode, fake = self.mode, self.synthetic_pose
            anchor = self.anchor_pose
            linear, angular = self.latest_command
        actual = self._actual_world_pose()
        if mode == "relay":
            return actual
        if mode == "freeze":
            if anchor is None or actual is None:
                return None
            return anchor[0], anchor[1], actual[2]
        if mode == "recovery":
            if fake is None:
                fake = anchor
            now = time.monotonic()
            dt = min(0.10, max(0.0, now - self._last_integrated_at))
            self._last_integrated_at = now
            if fake is None:
                return None
            x, y, yaw = fake
            yaw = math.atan2(math.sin(yaw + angular * dt), math.cos(yaw + angular * dt))
            x += linear * dt * math.cos(yaw)
            y += linear * dt * math.sin(yaw)
            self.synthetic_pose = (x, y, yaw)
            return self.synthetic_pose
        return actual

    def _publish_observations(self) -> None:
        if self.latest_odom is None or self.latest_scan is None or self.simulation_time_s is None:
            return
        actual = self._actual_world_pose()
        reported = self._pose_for_publish()
        if actual is None or reported is None:
            return
        rx, ry, ryaw = reported
        # Laser ranges originate at the physical Gazebo pose. Reproject each hit from
        # that pose into the reported frame so safety checks keep world geometry intact.
        ax, ay, ayaw = actual
        seconds = int(self.simulation_time_s)
        nanoseconds = int((self.simulation_time_s - seconds) * 1e9)
        odometry = copy.deepcopy(self.latest_odom)
        odometry.header.stamp.sec = seconds
        odometry.header.stamp.nanosec = nanoseconds
        odometry.pose.pose.position.x = rx - BASE_WORLD[0]
        odometry.pose.pose.position.y = ry - BASE_WORLD[1]
        odometry.pose.pose.position.z = 0.0
        odometry.pose.pose.orientation.x = 0.0
        odometry.pose.pose.orientation.y = 0.0
        odometry.pose.pose.orientation.z = math.sin(ryaw / 2)
        odometry.pose.pose.orientation.w = math.cos(ryaw / 2)
        self.odom_publisher.publish(odometry)
        if self.latest_telemetry is not None and self.generation is not None:
            try:
                telemetry = json.loads(self.latest_telemetry)
                telemetry["generation"] = self.generation
                telemetry["simulation_time_s"] = self.simulation_time_s
                telemetry["signal"] = 0.4  # isolate stuck recovery from unrelated sample-sensor noise
                self.telemetry_publisher.publish(String(data=json.dumps(telemetry)))
            except (json.JSONDecodeError, TypeError):
                pass

        scan = copy.deepcopy(self.latest_scan)
        scan.header.stamp.sec = seconds
        scan.header.stamp.nanosec = nanoseconds
        ranges = [float("inf")] * len(scan.ranges)
        for index, distance in enumerate(self.latest_scan.ranges):
            if not math.isfinite(distance) or not self.latest_scan.range_min <= distance <= self.latest_scan.range_max:
                continue
            beam = self.latest_scan.angle_min + index * self.latest_scan.angle_increment
            world_angle = ayaw + beam
            point_x = ax + distance * math.cos(world_angle)
            point_y = ay + distance * math.sin(world_angle)
            relative_x, relative_y = point_x - rx, point_y - ry
            fake_angle = math.atan2(relative_y, relative_x) - ryaw
            target = round((fake_angle - scan.angle_min) / scan.angle_increment)
            transformed_range = math.hypot(relative_x, relative_y)
            if 0 <= target < len(ranges) and transformed_range >= scan.range_min:
                ranges[target] = min(ranges[target], transformed_range)
        scan.ranges = ranges
        scan.intensities = [0.0] * len(ranges)
        self.scan_publisher.publish(scan)
        self.native_scan_publisher.publish(copy.deepcopy(self.latest_scan))

    def set_mode(self, mode: str, anchor: tuple[float, float, float] | None = None) -> None:
        with self._lock:
            self.mode = mode
            if anchor is not None:
                self.anchor_pose = anchor
                self.synthetic_pose = anchor
            if mode == "recovery":
                self._last_integrated_at = time.monotonic()
                self.latest_command = (0.0, 0.0)

    def start(self) -> None:
        self._stop.clear()

        def loop() -> None:
            while not self._stop.is_set():
                self._publish_observations()
                time.sleep(PUBLISH_PERIOD_S)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None


def titles(run_id: str) -> list[str]:
    page = request_json(f"/api/v1/runs/{run_id}/journal?after_sequence=0&limit=200")
    return [entry.get("title", "") for entry in page.get("entries", [])]


def journal_entries(run_id: str) -> list[dict]:
    return request_json(f"/api/v1/runs/{run_id}/journal?after_sequence=0&limit=200").get("entries", [])


def main() -> None:
    rclpy.init()
    probe = RecoveryProbe()
    probe.start()
    run_id: str | None = None
    report: dict = {"stack": "isolated didhack-t02", "odom_topic": ODOM_TOPIC, "scan_topic": SCAN_TOPIC,
                    "stuck_window_s": float(os.environ.get("STUCK_WINDOW_S", "6.0")), "seed": SEED}
    token = str(time.time_ns())
    try:
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            rclpy.spin_once(probe, timeout_sec=0.04)
            health = request_json("/api/v1/health")
            if health.get("ros_connected"):
                break
        else:
            raise RuntimeError("T12 observation relay did not make backend ROS-ready")

        with urllib.request.urlopen("http://simulation:7000/status", timeout=3.0) as response:
            supervisor_state = json.load(response)
        probe.generation = int(supervisor_state["generation"]) + 1
        started = request_json("/api/v1/runs", {
            "request_id": "t12-stuck-recovery-" + token,
            "scenario": "easy", "seed": SEED,
            "mission_text": "Исследуй ближайшую область и возвращайся с запасом.", "map_mode": "static",
        })
        run_id = started["run_id"]
        state = started
        deadline = time.monotonic() + 60.0
        active_route_ticks = 0
        while time.monotonic() < deadline:
            rclpy.spin_once(probe, timeout_sec=0.04)
            state = request_json("/api/v1/state")
            entries = journal_entries(run_id)
            recent_titles = [entry.get("title", "") for entry in entries[-10:]]
            goal_target = (state.get("current_goal") or {}).get("target")
            enough_goal_distance = bool(goal_target) and math.hypot(
                state["robot_pose"]["position_x_m"] - goal_target["position_x_m"],
                state["robot_pose"]["position_y_m"] - goal_target["position_y_m"],
            ) >= 0.40
            if (state.get("run_id") == run_id and state.get("status") == "running"
                    and state.get("current_goal") and state.get("planned_path")
                    and probe.physical_pose is not None
                    and math.dist(probe.physical_pose[:2], BASE_WORLD) >= 0.40
                    and enough_goal_distance
                    and probe.latest_command[0] > 0.02
                    and "Остановка перед препятствием" not in recent_titles):
                active_route_ticks += 1
                if active_route_ticks >= 8:
                    break
            else:
                active_route_ticks = 0
        else:
            raise RuntimeError("robot did not reach a clear translating route segment")

        anchor = (state["robot_pose"]["position_x_m"], state["robot_pose"]["position_y_m"],
                  state["robot_pose"]["heading_rad"])
        goal_before = state.get("current_goal")
        physical_at_anchor = probe.physical_pose
        probe.set_mode("freeze", anchor)
        report.update({"run_id": run_id, "generation": state.get("generation"), "anchor_pose": list(anchor),
                       "physical_pose_at_anchor": list(physical_at_anchor) if physical_at_anchor else None,
                       "goal_before_stall": goal_before})

        deadline = time.monotonic() + 12.0
        current_titles: list[str] = []
        while time.monotonic() < deadline:
            rclpy.spin_once(probe, timeout_sec=0.03)
            state = request_json("/api/v1/state")
            current_titles = titles(run_id)
            if "Безопасное восстановление" in current_titles:
                break
            if state.get("status") in ("failed", "completed", "stopped"):
                break
        recovery_started = "Безопасное восстановление" in current_titles
        physical_at_recovery = probe.physical_pose
        report.update({"recovery_started": recovery_started,
                       "titles_at_recovery_start": current_titles,
                       "physical_pose_at_recovery_start": list(physical_at_recovery)
                       if physical_at_recovery else None,
                       "physical_displacement_before_recovery_m":
                       round(math.dist(physical_at_anchor[:2], physical_at_recovery[:2]), 4)
                       if physical_at_anchor and physical_at_recovery else None})

        if recovery_started:
            # Model odometry from the actual agent velocity stream while Gazebo executes the same commands.
            probe.set_mode("recovery", anchor)
            recovery_deadline = time.monotonic() + 7.0
            while time.monotonic() < recovery_deadline:
                rclpy.spin_once(probe, timeout_sec=0.03)
                state = request_json("/api/v1/state")
                current_titles = titles(run_id)
                if "Восстановление завершено" in current_titles or "Манёвр восстановления прерван" in current_titles:
                    break
                if state.get("status") in ("failed", "completed", "stopped"):
                    break
            report["titles_after_recovery"] = current_titles
            report["recovery_completed"] = "Восстановление завершено" in current_titles
            report["recovery_failed"] = "Манёвр восстановления прерван" in current_titles
            report["state_after_recovery"] = {key: state.get(key) for key in
                                               ("status", "current_goal", "planned_path", "battery_remaining")}

        reverse_commands = [item for item in probe.commands if item["linear_mps"] < -0.01]
        turn_commands = [item for item in probe.commands if abs(item["angular_radps"]) > 0.1
                         and abs(item["linear_mps"]) < 0.01]
        physical_end = probe.physical_pose
        report.update({"reverse_command_count": len(reverse_commands), "turn_command_count": len(turn_commands),
                       "first_reverse_command": reverse_commands[0] if reverse_commands else None,
                       "first_turn_command": turn_commands[0] if turn_commands else None,
                       "physical_pose_after_probe": list(physical_end) if physical_end else None,
                       "command_samples": probe.commands[-300:]})
        request_json(f"/api/v1/runs/{run_id}/stop", {"request_id": "t12-probe-stop-" + token})
        report["stop_requested"] = True
    finally:
        probe.close()
        if run_id:
            try:
                state = request_json("/api/v1/state")
                if state.get("run_id") == run_id and state.get("status") not in (
                        "failed", "completed", "stopped"):
                    request_json(f"/api/v1/runs/{run_id}/stop", {"request_id": "t12-final-stop-" + token})
            except Exception as error:
                report["cleanup_error"] = str(error)
        if rclpy.ok():
            rclpy.shutdown()
        probe.destroy_node()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report.get("recovery_started") or not report.get("recovery_completed"):
        raise AssertionError("live Gazebo recovery sequence did not complete successfully")
    if not report.get("reverse_command_count") or not report.get("turn_command_count"):
        raise AssertionError("recovery did not issue both reverse and turn commands")


if __name__ == "__main__":
    main()
