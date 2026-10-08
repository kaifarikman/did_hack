"""Replay recorded world-frame lidar hits through the backend's dynamic navigation overlay."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from adapters.map_file import load_nav2_map  # noqa: E402
from application.navigation_service import NavigationService  # noqa: E402
from domain.energy import TerrainEstimator  # noqa: E402
from domain.geometry import Point  # noqa: E402
from domain.settings import MissionSettings  # noqa: E402

BASE = Point(-2.0, -0.5)
BOX_SIZE_M = 0.32
ROBOT_RADIUS_M = 0.11


def replay(report: dict, map_path: Path) -> dict:
    grid = load_nav2_map(map_path)
    navigation = NavigationService(grid, TerrainEstimator(), MissionSettings())
    obstacle_x, obstacle_y = report["obstacle_world_position"]
    removed_at = report.get("obstacle_removed_at_s")
    half_box = BOX_SIZE_M / 2
    frames = report["scan_frames"]
    states = [state for state in report["states"] if state["pose"] is not None]
    frame_index = 0
    rows = []
    min_clearance: float | None = None
    closest_command: dict | None = None

    for command in report["commands"]:
        if command["elapsed_s"] < report["obstacle_inserted_at_s"] or command["pose"] is None:
            continue
        if removed_at is not None and command["elapsed_s"] > removed_at:
            continue
        odom_x, odom_y, _ = command["pose"]
        world_x = report["odom_to_world_offset_m"][0] + odom_x
        world_y = report["odom_to_world_offset_m"][1] + odom_y
        gap_x = max(abs(world_x - obstacle_x) - half_box, 0.0)
        gap_y = max(abs(world_y - obstacle_y) - half_box, 0.0)
        clearance = math.hypot(gap_x, gap_y)
        if min_clearance is None or clearance < min_clearance:
            min_clearance = clearance
            closest_command = command

    for state in states:
        while frame_index < len(frames) and frames[frame_index]["elapsed_s"] <= state["elapsed_s"]:
            frame = frames[frame_index]
            navigation.observe_dynamic_obstacles(
                tuple(Point(*point) for point in frame["points_world"]), frame["elapsed_s"]
            )
            frame_index += 1
        pose = state["pose"]
        current = Point(pose["position_x_m"], pose["position_y_m"])
        route = navigation.route(current, BASE)
        obstacle_hit_points = [
            point for point, _expiry in navigation._dynamic_points.values()
            if abs(point.x_m - obstacle_x) <= half_box + 0.07
            and abs(point.y_m - obstacle_y) <= half_box + 0.07
        ]
        rows.append({
            "elapsed_s": state["elapsed_s"],
            "seconds_since_removal": round(state["elapsed_s"] - removed_at, 3) if removed_at is not None else None,
            "status": state["status"],
            "pose": [pose["position_x_m"], pose["position_y_m"]],
            "route_to_base_exists": route is not None,
            "route_to_base_length_m": round(route.length_m, 3) if route else None,
            "object_associated_hit_cells": len(obstacle_hit_points),
            "dynamic_cells": len(navigation._dynamic_expiry),
            "inflated_cells": len(navigation._dynamic_blocked),
            "overlay_revision": navigation.dynamic_obstacle_revision,
        })

    after_ttl = next(
        (row for row in rows if row["seconds_since_removal"] >= MissionSettings().dynamic_obstacle_ttl_s + 0.25),
        None,
    ) if removed_at is not None else None
    terminal = rows[-1] if rows else None
    return {
        "run_id": report["run_id"],
        "obstacle_inserted_at_s": report["obstacle_inserted_at_s"],
        "obstacle_removed_at_s": report["obstacle_removed_at_s"],
        "ttl_s": MissionSettings().dynamic_obstacle_ttl_s,
        "world_box_center_m": report["obstacle_world_position"],
        "minimum_command_sample_center_to_box_edge_m": round(min_clearance, 3) if min_clearance is not None else None,
        "robot_radius_m": ROBOT_RADIUS_M,
        "minimum_physical_center_to_box_edge_m": report.get("minimum_physical_center_to_box_edge_m"),
        "minimum_physical_surface_clearance_m": (
            round(report["minimum_physical_center_to_box_edge_m"] - report.get("robot_radius_m", ROBOT_RADIUS_M), 4)
            if report.get("minimum_physical_center_to_box_edge_m") is not None else None
        ),
        "closest_physical_clearance_sample": report.get("closest_physical_clearance_sample"),
        "physical_contacts_with_test_box": report.get("physical_contacts_with_test_box", []),
        "first_zero_command_elapsed_s": report["first_zero_after_insertion_s"],
        "first_zero_after_spawn_s": round(report["first_zero_after_insertion_s"] - report["obstacle_inserted_at_s"], 3)
        if report["first_zero_after_insertion_s"] is not None else None,
        "public_collision_events": len(report["collision_events"]),
        "rows": rows,
        "first_state_after_ttl": after_ttl,
        "terminal_state": terminal,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--map", type=Path, default=ROOT / "simulation/judge/data/map.yaml")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = replay(json.loads(args.report.read_text()), args.map)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
