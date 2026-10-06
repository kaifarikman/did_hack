"""Воспроизводимый генератор easy-сценария. Истинные данные принадлежат только судье."""
import math
import random
from dataclasses import dataclass
from typing import Tuple

from .config import JudgeConfig
from .occupancy import OccupancyGrid

Point = Tuple[float, float]


@dataclass(frozen=True)
class SoilZone:
    center: Point
    radius_m: float

    def contains(self, point: Point) -> bool:
        return math.dist(self.center, point) <= self.radius_m


@dataclass(frozen=True)
class Scenario:
    seed: int
    samples: Tuple[Point, ...]
    soil_zones: Tuple[SoilZone, ...]


class ScenarioGenerationError(RuntimeError):
    pass


def generate_easy_scenario(seed: int, grid: OccupancyGrid, config: JudgeConfig) -> Scenario:
    """Образцы и зоны ставятся в клетки, достижимые для робота с учётом его радиуса."""
    rng = random.Random(seed)
    safe_grid = grid.inflated(config.robot_radius_m + config.placement_margin_m)
    base = config.base_world_m
    reachable = [safe_grid.center_of(*cell)
                 for cell in safe_grid.reachable_from(safe_grid.cell_of(*base))]
    if not reachable:
        raise ScenarioGenerationError("От базы нет достижимых клеток")

    zone_candidates = [point for point in reachable
                       if math.dist(point, base) >= config.min_zone_distance_from_base_m]
    zones = tuple(_pick_zone(rng, zone_candidates, config) for _ in range(config.soil_zone_count))

    sample_candidates = [point for point in reachable
                         if math.dist(point, base) >= config.min_sample_distance_from_base_m]
    samples = _pick_spaced_points(rng, sample_candidates, config)
    return Scenario(seed=seed, samples=samples, soil_zones=zones)


def _pick_zone(rng: random.Random, candidates, config: JudgeConfig) -> SoilZone:
    if not candidates:
        raise ScenarioGenerationError("Нет места для грунтовой зоны")
    return SoilZone(center=rng.choice(candidates), radius_m=config.soil_zone_radius_m)


def _pick_spaced_points(rng: random.Random, candidates, config: JudgeConfig):
    pool = list(candidates)
    rng.shuffle(pool)
    chosen = []
    for point in pool:
        if all(math.dist(point, other) >= config.min_sample_spacing_m for other in chosen):
            chosen.append(point)
            if len(chosen) == config.sample_count:
                return tuple(chosen)
    raise ScenarioGenerationError("Не удалось разместить образцы с заданным разносом")
