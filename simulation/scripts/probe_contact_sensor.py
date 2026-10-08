"""Drive the isolated Burger into the nearest known world obstacle and record Contacts evidence."""
import json
import math
import os
import sys
import time
import urllib.request

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from ros_gz_interfaces.msg import Contacts
from std_msgs.msg import Float32, String
from rclpy.node import Node

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.contacts import has_obstacle_contact  # noqa: E402

BASE = (-2.0, -0.5)
OBSTACLE = (-1.1, -1.1)
OUTPUT = "/workspace/simulation/artifacts/t07-contact-probe.json"


class Probe(Node):
    def __init__(self):
        super().__init__("contact_sensor_probe")
        self.odom = None
        self.battery = None
        self.contacts_messages = 0
        self.contact_details = []
        self.events = []
        self.scores = []
        self.publisher = self.create_publisher(TwistStamped, "/agent/cmd_vel", 10)
        self.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self.create_subscription(Float32, "/did/battery", self._on_battery, 10)
        self.create_subscription(
            Contacts, "/world/default/model/burger/link/base_link/sensor/base_contact/contact",
            self._on_contact, 10)
        self.create_subscription(String, "/did/events", self._on_event, 10)
        self.create_subscription(String, "/did/score", self._on_score, 10)

    def _on_odom(self, message):
        p = message.pose.pose.position
        q = message.pose.pose.orientation
        yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
        self.odom = (p.x, p.y, yaw)

    def _on_contact(self, message):
        self.contacts_messages += 1
        if has_obstacle_contact(message, "burger"):
            for item in message.contacts:
                if not (item.collision1.name.startswith("burger::")
                        or item.collision2.name.startswith("burger::")):
                    continue
                pair = {"collision1": item.collision1.name, "collision2": item.collision2.name}
                if pair not in self.contact_details:
                    self.contact_details.append(pair)

    def _on_battery(self, message):
        self.battery = float(message.data)

    def _on_event(self, message):
        self.events.append(json.loads(message.data))

    def _on_score(self, message):
        self.scores.append(json.loads(message.data))

    def pulse(self, linear, angular):
        command = TwistStamped()
        command.twist.linear.x = linear
        command.twist.angular.z = angular
        self.publisher.publish(command)

    def drive(self, duration_s, linear, angular=0.0, stop_on_contact=False):
        deadline = time.monotonic() + duration_s
        while time.monotonic() < deadline:
            self.pulse(linear, angular)
            rclpy.spin_once(self, timeout_sec=0.03)
            if stop_on_contact and self.contact_details:
                self.pulse(0.0, 0.0)
                return
        self.pulse(0.0, 0.0)

    def turn_towards(self, target_heading, maximum_s=6.0):
        deadline = time.monotonic() + maximum_s
        while time.monotonic() < deadline:
            if self.odom is not None:
                error = math.atan2(math.sin(target_heading - self.odom[2]),
                                   math.cos(target_heading - self.odom[2]))
                if abs(error) <= 0.06:
                    break
                angular = 0.5 if error > 0 else -0.5
            else:
                angular = 0.0
            self.pulse(0.0, angular)
            rclpy.spin_once(self, timeout_sec=0.03)
        self.pulse(0.0, 0.0)


def require_backend_stopped():
    base = "http://backend:8000/api/v1"
    with urllib.request.urlopen(base + "/state", timeout=5) as response:
        state = json.load(response)
    if state.get("status") not in ("stopped", "idle", "failed", "completed"):
        raise RuntimeError("stop the backend run before the direct motion probe")
    return state


def main():
    terminal_state = require_backend_stopped()
    rclpy.init()
    probe = Probe()
    probe.drive(2.0, 0.0)
    if probe.odom is None:
        raise RuntimeError("probe did not receive odometry")
    initial_odom = probe.odom
    initial_battery = probe.battery
    start_world = (BASE[0] + initial_odom[0], BASE[1] + initial_odom[1])
    target_heading = math.atan2(OBSTACLE[1] - start_world[1], OBSTACLE[0] - start_world[0])
    probe.turn_towards(target_heading)
    probe.drive(20.0, 0.1, stop_on_contact=True)
    contact_odom = probe.odom
    probe.drive(1.5, 0.0)
    collision_events = [event for event in probe.events if event.get("type") == "collision"]
    final_odom = probe.odom
    result = {
        "terminal_backend_state_before_probe": terminal_state.get("status"),
        "initial_odom": initial_odom,
        "start_world": start_world,
        "initial_battery": initial_battery,
        "battery_drop_during_probe": (None if initial_battery is None or probe.battery is None
                                       else initial_battery - probe.battery),
        "contact_odom": contact_odom,
        "final_odom": final_odom,
        "battery_after_contact": probe.battery,
        "contacts_messages": probe.contacts_messages,
        "physical_contact_details": probe.contact_details,
        "judge_collision_events": collision_events,
        "latest_score": probe.scores[-1] if probe.scores else None,
        "contact_stop_drift_m": None,
    }
    if final_odom is not None and contact_odom is not None:
        result["contact_stop_drift_m"] = math.dist(contact_odom[:2], final_odom[:2])
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result, sort_keys=True))
    probe.destroy_node()
    rclpy.shutdown()
    if not collision_events:
        raise AssertionError("no judge collision event followed physical Gazebo contact")


if __name__ == "__main__":
    main()
