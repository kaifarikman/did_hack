import math

import pytest

from did_judge.occupancy import OccupancyGrid
from did_judge.scenario import ScenarioGenerationError, generate_easy_scenario

SEEDS = [0, 1, 2, 3, 42, 99, 12345]


def test_map_matches_world_geometry(grid, config):
    assert grid.is_free(*grid.cell_of(*config.base_world_m))
    for pillar in [(-1.1, -1.1), (0.0, 0.0), (1.1, 1.1), (1.1, -1.1), (0.0, 1.1)]:
        assert not grid.is_free(*grid.cell_of(*pillar)), pillar


def test_same_seed_gives_same_scenario(grid, config):
    assert generate_easy_scenario(5, grid, config) == generate_easy_scenario(5, grid, config)


def test_different_seeds_differ(grid, config):
    layouts = {generate_easy_scenario(seed, grid, config).samples for seed in SEEDS}
    assert len(layouts) > 1


@pytest.mark.parametrize("seed", SEEDS)
def test_easy_has_three_samples_and_one_zone(grid, config, seed):
    scenario = generate_easy_scenario(seed, grid, config)
    assert len(scenario.samples) == 3
    assert len(scenario.soil_zones) == 1


@pytest.mark.parametrize("seed", SEEDS)
def test_samples_are_reachable_and_clear_of_obstacles(grid, config, seed):
    scenario = generate_easy_scenario(seed, grid, config)
    safe = grid.inflated(config.robot_radius_m)
    reachable = set(safe.reachable_from(safe.cell_of(*config.base_world_m)))
    for sample in scenario.samples:
        assert safe.cell_of(*sample) in reachable
        assert math.dist(sample, config.base_world_m) >= config.min_sample_distance_from_base_m


@pytest.mark.parametrize("seed", SEEDS)
def test_samples_are_spaced(grid, config, seed):
    samples = generate_easy_scenario(seed, grid, config).samples
    for index, first in enumerate(samples):
        for second in samples[index + 1:]:
            assert math.dist(first, second) >= config.min_sample_spacing_m


def test_unreachable_base_is_reported(config):
    walls = OccupancyGrid(0.05, 0.0, 0.0, 4, 4, tuple([False] * 16))
    with pytest.raises(ScenarioGenerationError):
        generate_easy_scenario(1, walls, config)
