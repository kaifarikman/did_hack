"""Воспроизводимый генератор сценариев. Истинные данные принадлежат только судье."""
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


def stream_for(seed: int, purpose: str) -> random.Random:
    """Независимый поток случайности: размещение, шум и события не влияют друг на друга."""
    return random.Random(f"{seed}:{purpose}")


def generate_scenario(seed: int, grid: OccupancyGrid, config: JudgeConfig) -> Scenario:
    """Образцы и зоны ставятся в клетки, достижимые для робота и не слишком далёкие по энергии."""
    safe_grid = grid.inflated(config.robot_radius_m + config.placement_margin_m)
    base = config.base_world_m
    path_lengths = safe_grid.path_lengths_from(safe_grid.cell_of(*base))
    if not path_lengths:
        raise ScenarioGenerationError("От базы нет достижимых клеток")

    zone_candidates = [point for point in (safe_grid.center_of(*cell) for cell in path_lengths)
                       if math.dist(point, base) >= config.min_zone_distance_from_base_m]
    zone_rng = stream_for(seed, "zones")
    zones = tuple(_pick_zone(zone_rng, zone_candidates, config) for _ in range(config.soil_zone_count))

    sample_candidates = [safe_grid.center_of(*cell) for cell, length in path_lengths.items()
                         if _is_sample_place(safe_grid.center_of(*cell), length, config)]
    samples = _pick_spaced_points(stream_for(seed, "samples"), sample_candidates, config)
    return Scenario(seed=seed, samples=samples, soil_zones=zones)


def _is_sample_place(point: Point, path_length_m: float, config: JudgeConfig) -> bool:
    """Энергетическая разрешимость: путь туда и обратно укладывается в долю батареи."""
    round_trip_energy = 2.0 * path_length_m * config.energy_per_m
    return (math.dist(point, config.base_world_m) >= config.min_sample_distance_from_base_m
            and round_trip_energy <= config.battery_initial * config.max_round_trip_battery_fraction)


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
    raise ScenarioGenerationError(
        f"Не удалось разместить {config.sample_count} образцов: нужен разнос и запас батареи")
