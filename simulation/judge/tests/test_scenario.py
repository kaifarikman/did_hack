import math

import pytest

from did_judge.occupancy import OccupancyGrid
from did_judge.scenario import ScenarioGenerationError, generate_scenario

SEEDS = [0, 1, 2, 3, 42, 99, 12345]


def test_map_matches_world_geometry(grid, config):
    assert grid.is_free(*grid.cell_of(*config.base_world_m))
    for pillar in [(-1.1, -1.1), (0.0, 0.0), (1.1, 1.1), (1.1, -1.1), (0.0, 1.1)]:
        assert not grid.is_free(*grid.cell_of(*pillar)), pillar


def test_same_seed_gives_same_scenario(grid, config):
    assert generate_scenario(5, grid, config) == generate_scenario(5, grid, config)


def test_different_seeds_differ(grid, config):
    layouts = {generate_scenario(seed, grid, config).samples for seed in SEEDS}
    assert len(layouts) > 1


@pytest.mark.parametrize("seed", SEEDS)
def test_easy_has_three_samples_and_one_zone(grid, config, seed):
    scenario = generate_scenario(seed, grid, config)
    assert len(scenario.samples) == 3
    assert len(scenario.soil_zones) == 1


@pytest.mark.parametrize("seed", SEEDS)
def test_samples_are_reachable_and_clear_of_obstacles(grid, config, seed):
    scenario = generate_scenario(seed, grid, config)
    safe = grid.inflated(config.robot_radius_m)
    reachable = set(safe.reachable_from(safe.cell_of(*config.base_world_m)))
    for sample in scenario.samples:
        assert safe.cell_of(*sample) in reachable
        assert math.dist(sample, config.base_world_m) >= config.min_sample_distance_from_base_m


@pytest.mark.parametrize("seed", SEEDS)
def test_samples_are_spaced(grid, config, seed):
    samples = generate_scenario(seed, grid, config).samples
    for index, first in enumerate(samples):
        for second in samples[index + 1:]:
            assert math.dist(first, second) >= config.min_sample_spacing_m


def test_unreachable_base_is_reported(config):
    walls = OccupancyGrid(0.05, 0.0, 0.0, 4, 4, tuple([False] * 16))
    with pytest.raises(ScenarioGenerationError):
        generate_scenario(1, walls, config)


PROFILES = [("local_easy.json", 3, 1), ("local_medium.json", 5, 3), ("local_hard.json", 7, 4)]


@pytest.mark.parametrize("file_name,samples,zones", PROFILES)
@pytest.mark.parametrize("seed", SEEDS)
def test_profile_counts_and_energy_feasibility(grid, file_name, samples, zones, seed):
    import os
    from did_judge.config import JudgeConfig
    config = JudgeConfig.from_json_file(os.path.join(os.path.dirname(__file__), "..", "config", file_name))
    scenario = generate_scenario(seed, grid, config)
    assert len(scenario.samples) == samples and len(scenario.soil_zones) == zones
    safe = grid.inflated(config.robot_radius_m + config.placement_margin_m)
    lengths = safe.path_lengths_from(safe.cell_of(*config.base_world_m))
    for sample in scenario.samples:
        round_trip = 2 * lengths[safe.cell_of(*sample)] * config.energy_per_m
        assert round_trip <= config.battery_initial * config.max_round_trip_battery_fraction


def test_zone_layout_does_not_depend_on_sample_count(grid, config):
    from dataclasses import replace
    more_samples = replace(config, sample_count=5)
    assert (generate_scenario(4, grid, config).soil_zones
            == generate_scenario(4, grid, more_samples).soil_zones)


def test_energy_unsolvable_scenario_is_rejected_with_reason(grid, config):
    from dataclasses import replace
    starving = replace(config, battery_initial=3.0)
    with pytest.raises(ScenarioGenerationError, match="запас батареи"):
        generate_scenario(1, grid, starving)
