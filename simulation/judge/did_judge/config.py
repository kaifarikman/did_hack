"""Настройки локального судьи. Все числа — допущения проекта, не правила организаторов."""
import json
from dataclasses import dataclass, fields
from typing import Tuple


@dataclass(frozen=True)
class JudgeConfig:
    battery_initial: float = 60.0
    base_world_m: Tuple[float, float] = (-2.0, -0.5)
    sample_count: int = 3
    soil_zone_count: int = 1
    soil_zone_radius_m: float = 0.5
    collect_radius_m: float = 0.30
    finish_radius_m: float = 0.40
    robot_radius_m: float = 0.11
    placement_margin_m: float = 0.10
    min_sample_distance_from_base_m: float = 0.8
    min_sample_spacing_m: float = 0.8
    min_zone_distance_from_base_m: float = 1.0
    sensor_decay_length_m: float = 1.5
    sensor_noise_sigma: float = 0.03
    energy_per_m: float = 1.0
    soil_surcharge_per_m: float = 2.0
    rotation_energy_per_rad: float = 0.1
    idle_energy_per_s: float = 0.0
    collision_penalty_energy: float = 1.0
    false_collect_penalty_energy: float = 2.0
    score_per_sample: float = 10.0
    score_per_collision: float = 1.0
    score_per_false_collect: float = 2.0
    pose_jump_limit_m: float = 0.5
    max_round_trip_battery_fraction: float = 0.5

    @staticmethod
    def from_json_file(path: str) -> "JudgeConfig":
        with open(path, encoding="utf-8") as stream:
            raw_values = json.load(stream)
        known_names = {field.name for field in fields(JudgeConfig)}
        unknown = set(raw_values) - known_names
        if unknown:
            raise ValueError(f"Неизвестные параметры судьи: {sorted(unknown)}")
        if "base_world_m" in raw_values:
            raw_values["base_world_m"] = tuple(raw_values["base_world_m"])
        return JudgeConfig(**raw_values)
