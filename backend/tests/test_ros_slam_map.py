from adapters.ros.slam_map import grid_from_slam
from domain.geometry import Point
from domain.grid import FREE, OBSTACLE, UNKNOWN

BASE = (-2.0, -0.5)


def build(data, origin=(-1.0, -2.0), revision=1):
    return grid_from_slam(revision, 0.05, 2, 2, origin[0], origin[1], 0.0, data, BASE)


def test_cells_are_normalized_to_contract_values():
    grid = build([-1, 0, 100, 40])
    assert grid.cells == (UNKNOWN, FREE, OBSTACLE, FREE)


def test_origin_is_shifted_by_base_into_world_frame():
    grid = build([0, 0, 0, 0])
    assert (grid.origin.x_m, grid.origin.y_m) == (-3.0, -2.5)
    assert grid.world_to_cell(Point(-2.99, -2.49)) == (0, 0)


def test_map_id_changes_with_content_and_revision():
    first, second = build([0, 0, 0, 0]), build([0, 0, 100, 0])
    assert first.map_id != second.map_id
    assert build([0, 0, 0, 0], revision=2).map_id != first.map_id


def test_start_cell_is_at_base_in_world():
    grid = grid_from_slam(1, 0.05, 40, 40, -1.0, -1.0, 0.0, [0] * 1600, BASE)
    assert grid.world_to_cell(Point(*BASE)) == (20, 20)
