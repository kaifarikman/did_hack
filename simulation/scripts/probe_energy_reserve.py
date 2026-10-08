"""Inject conservative low-battery telemetry and verify the return commitment on the isolated stack."""
from __future__ import annotations

import json
import math
import os
import threading
import time
import urllib.request

import rclpy
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from std_msgs.msg import String

BACKEND_URL = os.environ.get("T11_BACKEND_URL", "http://backend:8000")
INJECTED_BATTERY = 1.0
MIN_DISTANCE_FROM_BASE_M = 0.30


def request_json(path: str, body: dict | None = None) -> dict:
    payload = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BACKEND_URL + path,
        data=payload,
        headers={"Content-Type": "application/json"} if payload is not None else {},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=2.0) as response:
        return json.load(response)


class ReserveProbe(Node):
    def __init__(self) -> None:
        super().__init__("t11_energy_reserve_probe")
        self.simulation_time_s = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.publisher = self.create_publisher(String, "/did/telemetry", 20)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)

    def _on_clock(self, message: Clock) -> None:
        self.simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9

    def start_low_battery_injection(self, generation: int) -> None:
        self._stop.clear()

        def publish_loop() -> None:
            while not self._stop.is_set():
                payload = {
                    "generation": generation,
                    "robot_id": "robot_1",
                    "simulation_time_s": self.simulation_time_s,
                    "battery": INJECTED_BATTERY,
                    "signal": 0.4,
                }
                self.publisher.publish(String(data=json.dumps(payload)))
                time.sleep(0.01)

        self._thread = threading.Thread(target=publish_loop, daemon=True)
        self._thread.start()

    def stop_low_battery_injection(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None


def main() -> None:
    rclpy.init()
    probe = ReserveProbe()
    run_id = None
    report = {
        "stack": "isolated didhack-t02",
        "injected_battery": INJECTED_BATTERY,
        "injection_is_conservative_only": True,
    }
    try:
        settle_until = time.monotonic() + 1.0
        while time.monotonic() < settle_until:
            rclpy.spin_once(probe, timeout_sec=0.02)
        token = str(time.time_ns())
        started = request_json("/api/v1/runs", {
            "request_id": "t11-energy-reserve-" + token,
            "scenario": "easy",
            "seed": 23,
            "mission_text": "Исследуй ближайшую область и возвращайся с запасом.",
            "map_mode": "static",
        })
        run_id = started["run_id"]
        report["run_id"] = run_id

        deadline = time.monotonic() + 60.0
        state = started
        while time.monotonic() < deadline:
            rclpy.spin_once(probe, timeout_sec=0.02)
            state = request_json("/api/v1/state")
            pose = state.get("robot_pose")
            base = state.get("base_position") or {"position_x_m": -2.0, "position_y_m": -0.5}
            if (state.get("status") == "running" and pose is not None
                    and state.get("current_goal") is not None
                    and state["current_goal"].get("kind") != "return"
                    and math.hypot(pose["position_x_m"] - base["position_x_m"],
                                   pose["position_y_m"] - base["position_y_m"]) >= MIN_DISTANCE_FROM_BASE_M):
                break
        else:
            raise RuntimeError("robot did not leave base within 60 seconds")

        generation = state.get("generation")
        if generation is None:
            raise RuntimeError("backend snapshot did not expose generation")
        report["generation"] = generation
        report["position_at_injection"] = state.get("robot_pose")
        report["status_before_injection"] = state.get("status")
        probe.start_low_battery_injection(generation)
        injection_started = time.monotonic()
        during: list[dict] = []
        journal_entries: list[dict] = []
        while time.monotonic() - injection_started < 5.0:
            rclpy.spin_once(probe, timeout_sec=0.02)
            state = request_json("/api/v1/state")
            during.append({
                "elapsed_s": round(time.monotonic() - injection_started, 3),
                "status": state.get("status"),
                "battery_remaining": state.get("battery_remaining"),
                "current_goal": state.get("current_goal"),
            })
            page = request_json(f"/api/v1/runs/{run_id}/journal?after_sequence=0&limit=200")
            journal_entries = page.get("entries", [])
            if state.get("status") == "returning":
                break
        probe.stop_low_battery_injection()
        state_after_restore = None
        restore_deadline = time.monotonic() + 2.0
        while time.monotonic() < restore_deadline:
            rclpy.spin_once(probe, timeout_sec=0.02)
            state_after_restore = request_json("/api/v1/state")
            if state_after_restore.get("status") in ("returning", "failed", "completed", "stopped"):
                time.sleep(0.2)
                break
        report.update({
            "injection_duration_s": round(time.monotonic() - injection_started, 3),
            "status_after_injection": state.get("status"),
            "battery_after_injection": state.get("battery_remaining"),
            "goal_after_injection": state.get("current_goal"),
            "journal_titles": [entry.get("title") for entry in journal_entries],
            "return_trigger_logged": any(entry.get("title") == "Возврат по запасу энергии"
                                          for entry in journal_entries),
            "status_after_native_telemetry_resumed": (
                state_after_restore.get("status") if state_after_restore else None
            ),
            "goal_after_native_telemetry_resumed": (
                state_after_restore.get("current_goal") if state_after_restore else None
            ),
            "observations_during_injection": during,
        })
    finally:
        probe.stop_low_battery_injection()
        if run_id:
            try:
                state = request_json("/api/v1/state")
                if state.get("run_id") == run_id and state.get("status") not in (
                    "failed", "completed", "stopped",
                ):
                    request_json(f"/api/v1/runs/{run_id}/stop", {
                        "request_id": "t11-probe-stop-" + str(time.time_ns()),
                    })
                    report["stop_requested"] = True
            except Exception as error:
                report["cleanup_error"] = str(error)
        if rclpy.ok():
            rclpy.shutdown()
        probe.destroy_node()
        output_path = os.environ.get(
            "T11_PROBE_OUTPUT", "/workspace/simulation/artifacts/t11-energy-reserve-probe.json",
        )
        with open(output_path, "w", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report.get("return_trigger_logged"):
        raise AssertionError("low-battery injection did not trigger the return policy")


if __name__ == "__main__":
    main()
