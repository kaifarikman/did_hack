import os
import sys

import pytest

JUDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, JUDGE_DIR)

from did_judge.config import JudgeConfig  # noqa: E402
from did_judge.engine import JudgeEngine  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from did_judge.scenario import Scenario, SoilZone, generate_scenario  # noqa: E402


@pytest.fixture(scope="session")
def grid():
    return load_occupancy_grid(os.path.join(JUDGE_DIR, "data", "map.yaml"))


@pytest.fixture
def config():
    return JudgeConfig()


@pytest.fixture
def scenario(grid, config):
    return generate_scenario(7, grid, config)


@pytest.fixture
def fixed_engine(config):
    """Движок с известным сценарием: образец в (0, 1.5), грунт вокруг (-1, -0.5)."""
    known = Scenario(seed=1, samples=((0.0, 1.5),), soil_zones=(SoilZone((-1.0, -0.5), 0.5),))
    engine = JudgeEngine(known, config)
    engine.update_pose(*config.base_world_m, 0.0, 0.0)
    return engine
