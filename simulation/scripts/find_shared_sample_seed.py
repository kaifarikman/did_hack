"""Ищет seed, где есть образец, видимый по прямой из обеих баз (для пробы одновременного сбора).

  python3 simulation/scripts/find_shared_sample_seed.py [easy|medium|hard]
Использует код генератора судьи; запускается на хосте без ROS. Проба использует истину только для проверки.
"""
import math
import os
import sys

SIMULATION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "judge"))
sys.path.insert(0, os.path.join(SIMULATION_DIR, "scripts"))
from did_judge.config import JudgeConfig  # noqa: E402
from did_judge.occupancy import load_occupancy_grid  # noqa: E402
from did_judge.scenario import generate_scenario  # noqa: E402
from robot_model import default_bases  # noqa: E402

CLEARANCE_M = 0.2


def line_is_clear(grid, start, end, step_m=0.02):
    distance = math.dist(start, end)
    steps = max(1, int(distance / step_m))
    safe = grid.inflated(CLEARANCE_M)
    return all(safe.is_free(*safe.cell_of(start[0] + (end[0] - start[0]) * i / steps,
                                          start[1] + (end[1] - start[1]) * i / steps))
               for i in range(steps + 1))


def find(scenario_name: str, limit: int = 300):
    config = JudgeConfig.from_json_file(os.path.join(SIMULATION_DIR, "judge", "config", f"local_{scenario_name}.json"))
    grid = load_occupancy_grid(os.path.join(SIMULATION_DIR, "judge", "data", "map.yaml"))
    bases = list(default_bases(2).values())
    for seed in range(1, limit):
        for sample in generate_scenario(seed, grid, config).samples:
            if all(line_is_clear(grid, base, sample) for base in bases):
                return seed, sample
    return None


if __name__ == "__main__":
    print(find(sys.argv[1] if len(sys.argv) > 1 else "easy"))
