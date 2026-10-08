"""Observe one hidden-event hard generation, then deliberately enter its hazard zone.

Run only after starting a hard judge generation through the isolated supervisor and
confirming the backend mission is terminal. Schedule data is test-side oracle only;
it is never published to ROS or the backend. The report stores it in a post-run section.
"""
import heapq
import json
import math
import os
import statistics
import sys
import time
import urllib.request

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from std_msgs.msg import String

SIM_DIR = os.environ.get("SIMULATION_DIR", "/workspace/simulation")
sys.path.insert(0, os.path.join(SIM_DIR, "judge"))
from did_judge.config import JudgeConfig  # noqa: E402
from did_judge.dynamics import generate_event_schedule  # noqa: E402
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from did_judge.scenario import generate_scenario  # noqa: E402

BASE = (-2.0, -0.5)
OUTPUT = os.path.join(SIM_DIR, "artifacts", "t08-hard-observer.json")


def terminal_backend_state():
    with urllib.request.urlopen("http://backend:8000/api/v1/state", timeout=5) as response:
        state = json.load(response)
    if state.get("status") not in ("idle", "stopped", "failed", "completed"):
        raise RuntimeError("stop the backend mission before the direct event probe")
    return state


def route_to_hazard(grid, center, radius, start_world):
    safe = grid.inflated(0.21)
    start = safe.cell_of(*start_world)
    targets = [(column, row) for row in range(safe.height) for column in range(safe.width)
               if safe.is_free(column, row)
               and math.dist(safe.center_of(column, row), center) <= radius * 0.65]
    if not targets:
        raise RuntimeError("no robot-clear map cell inside the hidden hazard")
    queue = [(0.0, start)]
    distance = {start: 0.0}
    parent = {}
    target_set = set(targets)
    reached = None
    while queue:
        cost, cell = heapq.heappop(queue)
        if cost != distance[cell]:
            continue
        if cell in target_set:
            reached = cell
            break
        column, row = cell
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                next_cell = (column + dc, row + dr)
                if not (dc or dr) or not safe.is_free(*next_cell):
                    continue
                if dc and dr and not (safe.is_free(column + dc, row)
                                      and safe.is_free(column, row + dr)):
                    continue
                candidate = cost + math.hypot(dc, dr) * safe.resolution_m
                if candidate < distance.get(next_cell, math.inf):
                    distance[next_cell] = candidate
                    parent[next_cell] = cell
                    heapq.heappush(queue, (candidate, next_cell))
    if reached is None:
        raise RuntimeError("hidden hazard is unreachable on the inflated static map")
    cells = [reached]
    while cells[-1] != start:
        cells.append(parent[cells[-1]])
    route = [safe.center_of(*cell) for cell in reversed(cells)]
    route.append(center)
    return route, distance[reached]


class EventProbe(Node):
    def __init__(self):
        super().__init__("hard_event_observer_probe")
        self.simulation_time_s = 0.0
        self.odom = None
        self.physical_pose_source = GazeboPoseSource()
        self.telemetry = []
        self.events = []
        self.scores = []
        self.publisher = self.create_publisher(TwistStamped, "/agent/cmd_vel", 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self.create_subscription(String, "/did/telemetry", self._on_telemetry, 10)
        self.create_subscription(String, "/did/events", self._on_event, 10)
        self.create_subscription(String, "/did/score", self._on_score, 10)

    def _on_clock(self, message):
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _on_odom(self, message):
        position, orientation = message.pose.pose.position, message.pose.pose.orientation
        yaw = math.atan2(2 * (orientation.w * orientation.z + orientation.x * orientation.y),
                         1 - 2 * (orientation.y ** 2 + orientation.z ** 2))
        self.odom = (BASE[0] + position.x, BASE[1] + position.y, yaw)

    def _on_telemetry(self, message):
        self.telemetry.append(json.loads(message.data))

    def _on_event(self, message):
        self.events.append(json.loads(message.data))

    def _on_score(self, message):
        self.scores.append(json.loads(message.data))

    def command(self, linear=0.0, angular=0.0):
        message = TwistStamped()
        message.twist.linear.x = linear
        message.twist.angular.z = angular
        self.publisher.publish(message)

    def navigate_route(self, route, deadline_wall_s, arrival_tolerance_m=0.13):
        waypoint = 0
        while waypoint < len(route) and time.monotonic() < deadline_wall_s:
            rclpy.spin_once(self, timeout_sec=0.04)
            pose = self.physical_pose_source.latest()
            if pose is None:
                self.command()
                continue
            x, y, yaw = pose
            target_x, target_y = route[waypoint]
            distance = math.hypot(target_x - x, target_y - y)
            if distance < arrival_tolerance_m:
                waypoint += 1
                continue
            bearing = math.atan2(target_y - y, target_x - x)
            error = math.atan2(math.sin(bearing - yaw), math.cos(bearing - yaw))
            angular = max(-0.35, min(0.35, 1.2 * error))
            linear = 0.12 if abs(error) < 0.25 else 0.0
            self.command(linear, angular)
        self.command()
        return waypoint == len(route)


def main():
    terminal_state = terminal_backend_state()
    supervisor_url = "http://simulation:7000/status"
    with urllib.request.urlopen(supervisor_url, timeout=5) as response:
        live_supervisor = json.load(response)
    if live_supervisor.get("scenario") != "hard":
        raise RuntimeError("supervisor must run a hard generation")
    seed = int(live_supervisor["seed"])
    generation = int(live_supervisor["generation"])
    config_path = os.path.join(SIM_DIR, "judge", "config", "local_hard.json")
    config = JudgeConfig.from_json_file(config_path)
    grid = load_occupancy_grid(os.path.join(SIM_DIR, "judge", "data", "map.yaml"))
    scenario = generate_scenario(seed, grid, config)
    schedule = generate_event_schedule(seed, grid, config, scenario)
    rclpy.init()
    probe = EventProbe()
    pose_deadline = time.monotonic() + 5
    while probe.physical_pose_source.latest() is None and time.monotonic() < pose_deadline:
        rclpy.spin_once(probe, timeout_sec=0.1)
    physical_start = probe.physical_pose_source.latest()
    if physical_start is None:
        raise RuntimeError("no physical robot pose available")
    route, route_length = route_to_hazard(grid, schedule.hazard_zone.center,
                                          config.hazard_zone_radius_m, physical_start[:2])
    last_progress_wall = 0.0
    hazard_route_started = False
    route_reached = False
    wall_deadline = time.monotonic() + 900
    try:
        while time.monotonic() < wall_deadline:
            rclpy.spin_once(probe, timeout_sec=0.1)
            if not hazard_route_started and probe.simulation_time_s >= schedule.hazard_time_s + 1:
                hazard_route_started = True
                route_reached = probe.navigate_route(route, time.monotonic() + 300)
                break
            if any(event.get("type") == "hazard_hit" for event in probe.events):
                break
            if time.monotonic() - last_progress_wall > 20:
                print(json.dumps({"generation": generation,
                                  "simulation_time_s": probe.simulation_time_s,
                                  "telemetry_count": len(probe.telemetry),
                                  "events": len(probe.events)}), flush=True)
                last_progress_wall = time.monotonic()
        probe.command()
        time.sleep(0.5)
        rclpy.spin_once(probe, timeout_sec=0.1)
    finally:
        probe.command()

    fault_observations = {}
    for fault in schedule.sensor_faults:
        rows = [row for row in probe.telemetry
                if fault.start_s - 2 <= row.get("simulation_time_s", -1) <= fault.end_s + 4]
        core_rows = [row for row in probe.telemetry
                     if fault.start_s <= row.get("simulation_time_s", -1) < fault.end_s]
        recovery_rows = [row for row in probe.telemetry
                         if fault.end_s <= row.get("simulation_time_s", -1) <= fault.end_s + 6]
        core_values = [row["signal"] for row in core_rows if row.get("signal") is not None]
        core_differences = [abs(right - left) for left, right in zip(core_values, core_values[1:])]
        normal_rows = [row for row in probe.telemetry
                       if row.get("simulation_time_s", -1) < fault.start_s - 2
                       and schedule.sensor_fault_at(row.get("simulation_time_s", -1)) is None
                       and row.get("signal") is not None][-60:]
        normal_values = [row["signal"] for row in normal_rows]
        normal_pairs = [(left, right) for left, right in zip(normal_rows, normal_rows[1:])
                        if right["simulation_time_s"] - left["simulation_time_s"] <= 0.5]
        normal_differences = [abs(right["signal"] - left["signal"])
                              for left, right in normal_pairs]
        recovery_values = [row["signal"] for row in recovery_rows if row.get("signal") is not None]
        fault_observations[fault.kind] = {
            "scheduled_window_s": [fault.start_s, fault.end_s],
            "telemetry_samples": len(rows),
            "null_samples": sum(row.get("signal") is None for row in rows),
            "unique_rounded_values": len({round(row["signal"], 5) for row in rows
                                           if row.get("signal") is not None}),
            "core_samples": len(core_rows),
            "core_null_samples": sum(row.get("signal") is None for row in core_rows),
            "core_unique_values": len({round(value, 7) for value in core_values}),
            "core_median_abs_difference": statistics.median(core_differences) if core_differences else None,
            "normal_median_abs_difference": statistics.median(normal_differences)
            if normal_differences else None,
            "recovery_samples": len(recovery_rows),
            "recovery_non_null_samples": len(recovery_values),
            "recovery_unique_values": len({round(value, 5) for value in recovery_values}),
        }
    with open("/tmp/did_soil_state.json", encoding="utf-8") as stream:
        observed_soil_state = json.load(stream)
    result = {
        "backend_terminal_state_before_probe": terminal_state.get("status"),
        "scenario": "hard", "seed": seed, "generation": generation,
        "observed_until_simulation_s": probe.simulation_time_s,
        "telemetry_count": len(probe.telemetry),
        "fault_observations": fault_observations,
        "hazard_route_length_m": route_length,
        "hazard_route_started": hazard_route_started,
        "hazard_route_reached": route_reached,
        "final_world_pose": probe.physical_pose_source.latest(),
        "final_odom_world_estimate": probe.odom,
        "judge_events": probe.events,
        "latest_score": probe.scores[-1] if probe.scores else None,
        "post_run_soil_state": observed_soil_state,
        "post_run_schedule_audit": {
            "initial_soil_zones": [{"center": zone.center, "radius_m": zone.radius_m}
                                   for zone in scenario.soil_zones],
            "soil_shift_time_s": schedule.soil_shift_time_s,
            "shifted_zone_center": schedule.shifted_zone_center,
            "hazard_time_s": schedule.hazard_time_s,
            "hazard_center": schedule.hazard_zone.center,
            "sensor_faults": [{"kind": fault.kind, "start_s": fault.start_s,
                               "end_s": fault.end_s} for fault in schedule.sensor_faults],
            "visibility": "test-only audit; not published to the agent/backend",
        },
        "limitations": "Direct controlled probe, not an autonomous mission or adaptation success.",
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result, ensure_ascii=False))
    probe.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
