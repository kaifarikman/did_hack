from did_judge.scenario import SoilZone
from did_judge.soil_slowdown import speed_factor_at, write_soil_state

BASE = (-2.0, -0.5)


def test_factor_applies_only_inside_zone(tmp_path):
    path = str(tmp_path / "soil.json")
    write_soil_state(path, BASE, [SoilZone((-1.0, -0.5), 0.5)], 0.5)
    assert speed_factor_at(path, 1.0, 0.0) == 0.5   # мир (-1.0, -0.5): центр зоны
    assert speed_factor_at(path, 0.0, 0.0) == 1.0   # база вне зоны


def test_missing_or_corrupt_state_means_no_slowdown(tmp_path):
    path = tmp_path / "soil.json"
    assert speed_factor_at(str(path), 1.0, 0.0) == 1.0
    path.write_text("{oops")
    assert speed_factor_at(str(path), 1.0, 0.0) == 1.0


def test_rewrite_moves_the_zone(tmp_path):
    path = str(tmp_path / "soil.json")
    write_soil_state(path, BASE, [SoilZone((-1.0, -0.5), 0.5)], 0.5)
    write_soil_state(path, BASE, [SoilZone((1.0, 1.0), 0.5)], 0.5)
    assert speed_factor_at(path, 1.0, 0.0) == 1.0
    assert speed_factor_at(path, 3.0, 1.5) == 0.5
