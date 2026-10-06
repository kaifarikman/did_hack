import math

from adapters.map_file import load_nav2_map
from adapters.ros.conversion import (
    clamp_signal, is_penalty_event, world_pose_from_odom, yaw_from_quaternion,
)
from pathlib import Path

MAP_YAML = Path(__file__).resolve().parents[2] / "simulation/judge/data/map.yaml"


def test_odom_origin_is_robot_start_in_world():
    pose = world_pose_from_odom(0.0, 0.0, 0.0)
    assert (pose.x_m, pose.y_m) == (-2.0, -0.5)


def test_odom_shift_and_nonfinite_rejected():
    pose = world_pose_from_odom(0.5, 0.25, 1.0)
    assert (pose.x_m, pose.y_m) == (-1.5, -0.25)
    assert world_pose_from_odom(float("nan"), 0.0, 0.0) is None


def test_yaw_from_quaternion_quarter_turn():
    assert math.isclose(yaw_from_quaternion(0, 0, math.sin(math.pi / 4), math.cos(math.pi / 4)), math.pi / 2)


def test_signal_clamped_and_invalid_is_none():
    assert clamp_signal(1.4) == 1.0 and clamp_signal(-0.1) == 0.0 and clamp_signal(float("inf")) is None


def test_penalty_events_only():
    assert is_penalty_event('{"type": "collision"}')
    assert not is_penalty_event('{"type": "sample_collected"}')
    assert not is_penalty_event("не json")


def test_real_map_is_normalized_with_free_start():
    grid = load_nav2_map(MAP_YAML)
    assert (grid.width, grid.height) == (len(grid.cells) // grid.height, grid.height)
    column, row = grid.world_to_cell(__import__("domain.geometry", fromlist=["Point"]).Point(-2.0, -0.5))
    assert grid.cells[grid.index(column, row)] == 0
