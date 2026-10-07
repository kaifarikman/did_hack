"""Скрытые события hard: смена грунта, опасная зона, неисправности датчика образцов.

Расписание строится из отдельного потока случайности «events» и не публикуется.
Агент узнаёт о событиях только по наблюдениям: расход, событие hazard_hit, сигнал датчика.
"""
import math
from dataclasses import dataclass
from typing import Optional, Tuple

from .config import JudgeConfig
from .occupancy import OccupancyGrid
from .scenario import Scenario, ScenarioGenerationError, SoilZone, stream_for

Point = Tuple[float, float]
SENSOR_DROPOUT = "dropout"
SENSOR_STUCK = "stuck"
SENSOR_NOISY = "noisy"


@dataclass(frozen=True)
class SensorFault:
    kind: str
    start_s: float
    end_s: float

    def active_at(self, time_s: float) -> bool:
        return self.start_s <= time_s < self.end_s


@dataclass(frozen=True)
class EventSchedule:
    soil_shift_time_s: float
    shifted_zone_index: int
    shifted_zone_center: Point
    hazard_time_s: float
    hazard_zone: SoilZone
    sensor_faults: Tuple[SensorFault, ...]

    def soil_zones_at(self, scenario: Scenario, time_s: float) -> Tuple[SoilZone, ...]:
        if time_s < self.soil_shift_time_s:
            return scenario.soil_zones
        zones = list(scenario.soil_zones)
        zones[self.shifted_zone_index] = SoilZone(self.shifted_zone_center,
                                                  zones[self.shifted_zone_index].radius_m)
        return tuple(zones)

    def hazard_at(self, time_s: float) -> Optional[SoilZone]:
        return self.hazard_zone if time_s >= self.hazard_time_s else None

    def sensor_fault_at(self, time_s: float) -> Optional[SensorFault]:
        return next((fault for fault in self.sensor_faults if fault.active_at(time_s)), None)


def generate_event_schedule(seed: int, grid: OccupancyGrid, config: JudgeConfig,
                            scenario: Scenario) -> EventSchedule:
    """События начинаются не раньше event_earliest_s и укладываются в окно event_window_s."""
    if not scenario.soil_zones:
        raise ScenarioGenerationError("Для смены грунта нужна хотя бы одна зона")
    rng = stream_for(seed, "events")
    safe_grid = grid.inflated(config.robot_radius_m + config.placement_margin_m)
    base = config.base_world_m
    places = [point for point in (safe_grid.center_of(*cell)
              for cell in safe_grid.path_lengths_from(safe_grid.cell_of(*base)))
              if math.dist(point, base) >= config.min_zone_distance_from_base_m]
    if not places:
        raise ScenarioGenerationError("Нет места для событий")

    def event_time() -> float:
        return rng.uniform(config.event_earliest_s, config.event_earliest_s + config.event_window_s)

    zone_index = rng.randrange(len(scenario.soil_zones))
    shifted_center = rng.choice(places)
    soil_shift_time = event_time()
    hazard_zone = SoilZone(rng.choice(places), config.hazard_zone_radius_m)
    hazard_time = event_time()
    faults = tuple(sorted(
        (_make_fault(rng, kind, config) for kind in (SENSOR_DROPOUT, SENSOR_STUCK, SENSOR_NOISY)),
        key=lambda fault: fault.start_s))
    return EventSchedule(soil_shift_time, zone_index, shifted_center, hazard_time, hazard_zone, faults)


def _make_fault(rng, kind: str, config: JudgeConfig) -> SensorFault:
    start = rng.uniform(config.event_earliest_s, config.event_earliest_s + config.event_window_s)
    return SensorFault(kind, start, start + config.sensor_fault_duration_s)
