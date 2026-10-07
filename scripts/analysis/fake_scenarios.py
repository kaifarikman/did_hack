"""Случайные сценарии профилей для подменной среды backend (не Gazebo, не скрытые сценарии A).

Размещение повторяет правила локального судьи: образцы не ближе 0.8 м к базе и друг к другу,
грунтовые зоны радиусом 0.5 м с надбавкой 2 ед./м, расход на поворот 0.1 ед./рад.
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path[:0] = [str(BACKEND / "src"), str(BACKEND / "tests")]

from domain.geometry import Point, distance_m  # noqa: E402
from domain.profiles import PUBLIC_PROFILES  # noqa: E402
from fakes import FakeClock, SimWorld, Zone, build_arena  # noqa: E402

BASE = Point(-2.0, -0.5)


def _free_point(rng: random.Random, grid, blocked, taken: list[Point], min_gap: float) -> Point:
    while True:
        point = Point(rng.uniform(-3.5, 3.5), rng.uniform(-2.5, 2.5))
        cell = grid.world_to_cell(point)
        if cell is None or grid.index(*cell) in blocked:
            continue
        if distance_m(point, BASE) < 0.8 or any(distance_m(point, other) < min_gap for other in taken):
            continue
        return point


def make_world(profile: str, seed: int, **world_options) -> SimWorld:
    rules = PUBLIC_PROFILES[profile]
    rng = random.Random(f"{profile}-{seed}")
    grid = build_arena()
    blocked = grid.inflated_blocked(0.21)
    samples: list[Point] = []
    for _ in range(rules.sample_count):
        samples.append(_free_point(rng, grid, blocked, samples, 0.8))
    zones = [Zone(_free_point(rng, grid, blocked, [], 0.0), 0.5, 3.0) for _ in range(rules.soil_zone_count)]
    return SimWorld(FakeClock(), samples, zones=zones, seed=seed, rotation_energy_per_rad=0.1,
                    signal_noise=0.03, **world_options)
