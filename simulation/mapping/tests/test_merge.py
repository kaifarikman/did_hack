import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from merge import FREE, OCCUPIED, UNKNOWN, RobotMap, merge_maps  # noqa: E402

RESOLUTION = 0.5


def robot_map(data, width, height, start, origin=(0.0, 0.0)):
    return RobotMap(RESOLUTION, width, height, origin[0], origin[1], data, start)


def cell(merged, world_x, world_y):
    column = round((world_x - merged.origin_x_m) / merged.resolution_m)
    row = round((world_y - merged.origin_y_m) / merged.resolution_m)
    return merged.data[row * merged.width + column]


def test_single_map_is_shifted_into_world():
    merged = merge_maps([robot_map([0, 100, -1, 0], 2, 2, start=(-2.0, -0.5))])
    assert (merged.origin_x_m, merged.origin_y_m) == (-2.0, -0.5)
    assert cell(merged, -1.5, -0.5) == OCCUPIED and cell(merged, -2.0, 0.0) == UNKNOWN


def test_two_maps_cover_union_with_own_starts():
    first = robot_map([0] * 4, 2, 2, start=(0.0, 0.0))
    second = robot_map([100] * 4, 2, 2, start=(0.0, 2.0))
    merged = merge_maps([first, second])
    assert (merged.width, merged.height) == (2, 6)
    assert cell(merged, 0.0, 0.0) == FREE and cell(merged, 0.0, 2.0) == OCCUPIED
    assert cell(merged, 0.0, 1.5) == UNKNOWN  # зазор между картами


def test_overlap_prefers_occupied_over_free_over_unknown():
    first = robot_map([0, 0, -1, -1], 2, 2, start=(0.0, 0.0))
    second = robot_map([100, -1, 0, -1], 2, 2, start=(0.0, 0.0))
    merged = merge_maps([first, second])
    assert merged.data == [OCCUPIED, FREE, FREE, UNKNOWN]


def test_maps_with_origin_offsets_align_on_world_lattice():
    first = robot_map([0], 1, 1, start=(1.0, 1.0), origin=(-0.5, -0.5))   # клетка мира (0.5, 0.5)
    second = robot_map([100], 1, 1, start=(0.0, 0.0), origin=(0.5, 0.5))  # та же клетка
    merged = merge_maps([first, second])
    assert merged.data == [OCCUPIED] and (merged.origin_x_m, merged.origin_y_m) == (0.5, 0.5)


def test_different_resolutions_are_rejected():
    other = RobotMap(0.25, 1, 1, 0.0, 0.0, [0], (0.0, 0.0))
    with pytest.raises(ValueError):
        merge_maps([robot_map([0], 1, 1, (0.0, 0.0)), other])


def test_no_maps_is_rejected():
    with pytest.raises(ValueError):
        merge_maps([])
