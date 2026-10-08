"""Measure judge energy on the same old/new soil patches before and after a hard shift."""
import json
import math
import os
import sys
import time
import urllib.request

import rclpy

SIM_DIR = os.environ.get("SIMULATION_DIR", "/workspace/simulation")
sys.path.insert(0, os.path.join(SIM_DIR, "scripts"))
sys.path.insert(0, os.path.join(SIM_DIR, "judge"))
from probe_hard_events import EventProbe, route_to_hazard, terminal_backend_state  # noqa: E402
from did_judge.config import JudgeConfig  # noqa: E402
from did_judge.dynamics import generate_event_schedule  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from did_judge.scenario import generate_scenario  # noqa: E402

OUTPUT = os.path.join(SIM_DIR, "artifacts", "t08-soil-shift-probe.json")


def latest_battery(probe):
    if not probe.telemetry:
        return None
    return probe.telemetry[-1].get("battery")


def settle(probe, duration_s=1.0):
    deadline = time.monotonic() + duration_s
    while time.monotonic() < deadline:
        probe.command()
        rclpy.spin_once(probe, timeout_sec=0.05)


def navigate(probe, grid, point):
    pose = probe.physical_pose_source.latest()
    route, _ = route_to_hazard(grid, point, 0.1, pose[:2])
    if not probe.navigate_route(route, time.monotonic() + 180, arrival_tolerance_m=0.04):
        raise RuntimeError(f"failed to reach test point {point}")
    probe.command()
    settle(probe, 1.0)


def measure_line(probe, grid, center, label, config, zones, simulation_time_s):
    start = (center[0] - 0.15, center[1])
    end = (center[0] + 0.15, center[1])
    navigate(probe, grid, start)
    before_pose = probe.physical_pose_source.latest()
    before_battery = latest_battery(probe)
    if not probe.navigate_route([end], time.monotonic() + 60, arrival_tolerance_m=0.04):
        raise RuntimeError(f"failed to traverse test line {label}")
    probe.command()
    settle(probe, 1.0)
    after_pose = probe.physical_pose_source.latest()
    after_battery = latest_battery(probe)
    if before_pose is None or after_pose is None or before_battery is None or after_battery is None:
        raise RuntimeError(f"missing pose or battery observation in {label}")
    distance = math.dist(before_pose[:2], after_pose[:2])
    heading = abs(math.atan2(math.sin(after_pose[2] - before_pose[2]),
                             math.cos(after_pose[2] - before_pose[2])))
    battery_drop = before_battery - after_battery
    rotation_cost = heading * config.rotation_energy_per_rad
    midpoint = ((before_pose[0] + after_pose[0]) / 2,
                (before_pose[1] + after_pose[1]) / 2)
    in_soil = any(zone.contains(midpoint) for zone in zones)
    return {
        "label": label,
        "simulation_time_s": simulation_time_s,
        "start_world": before_pose,
        "end_world": after_pose,
        "distance_m": distance,
        "heading_change_rad": heading,
        "battery_before": before_battery,
        "battery_after": after_battery,
        "observed_battery_drop": battery_drop,
        "rotation_energy_estimate": rotation_cost,
        "observed_energy_per_m_after_rotation": (battery_drop - rotation_cost) / distance,
        "judge_expected_energy_per_m": config.energy_per_m
        + (config.soil_surcharge_per_m if in_soil else 0.0),
        "midpoint_in_soil": in_soil,
    }


def main():
    backend_state = terminal_backend_state()
    with urllib.request.urlopen("http://simulation:7000/status", timeout=5) as response:
        supervisor = json.load(response)
    if supervisor.get("scenario") != "hard":
        raise RuntimeError("supervisor must be running a hard generation")
    seed, generation = int(supervisor["seed"]), int(supervisor["generation"])
    config = JudgeConfig.from_json_file(os.path.join(SIM_DIR, "judge", "config", "local_hard.json"))
    grid = load_occupancy_grid(os.path.join(SIM_DIR, "judge", "data", "map.yaml"))
    scenario = generate_scenario(seed, grid, config)
    schedule = generate_event_schedule(seed, grid, config, scenario)
    old_zone = scenario.soil_zones[schedule.shifted_zone_index]
    old_center, new_center = old_zone.center, schedule.shifted_zone_center

    rclpy.init()
    probe = EventProbe()
    deadline = time.monotonic() + 5
    while probe.physical_pose_source.latest() is None or not probe.telemetry:
        rclpy.spin_once(probe, timeout_sec=0.1)
        if time.monotonic() > deadline:
            raise RuntimeError("judge telemetry or physical pose not ready")
    results = []
    try:
        results.append(measure_line(probe, grid, old_center, "old_zone_before_shift",
                                    config, scenario.soil_zones, probe.simulation_time_s))
        results.append(measure_line(probe, grid, new_center, "new_center_before_shift",
                                    config, scenario.soil_zones, probe.simulation_time_s))
        while probe.simulation_time_s < schedule.soil_shift_time_s + 1:
            probe.command()
            rclpy.spin_once(probe, timeout_sec=0.05)
        results.append(measure_line(probe, grid, old_center, "old_zone_after_shift",
                                    config, schedule.soil_zones_at(scenario, probe.simulation_time_s),
                                    probe.simulation_time_s))
        results.append(measure_line(probe, grid, new_center, "new_zone_after_shift",
                                    config, schedule.soil_zones_at(scenario, probe.simulation_time_s),
                                    probe.simulation_time_s))
        probe.command()
        settle(probe, 0.5)
    finally:
        probe.command()
    soil_state_path = "/tmp/did_soil_state.json"
    with open(soil_state_path, encoding="utf-8") as stream:
        published_soil_state = json.load(stream)
    result = {
        "backend_terminal_state_before_probe": backend_state.get("status"),
        "scenario": "hard", "seed": seed, "generation": generation,
        "soil_shift_time_s": schedule.soil_shift_time_s,
        "old_zone": {"center": old_center, "radius_m": old_zone.radius_m},
        "new_zone_center": new_center,
        "measurements": results,
        "published_guard_state_after_shift": published_soil_state,
        "interpretation": "direct test-side motion through identical 0.3m segments; no mission planner",
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result, ensure_ascii=False))
    probe.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
