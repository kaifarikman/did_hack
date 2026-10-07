"""Ядро судьи: батарея, датчик, сбор, завершение, счёт. Без ROS и сети."""
import math
import random
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from .config import JudgeConfig
from .dynamics import EventSchedule, SENSOR_DROPOUT, SENSOR_NOISY, SENSOR_STUCK
from .scenario import Scenario

Point = Tuple[float, float]


@dataclass(frozen=True)
class JudgeEvent:
    kind: str  # collision | false_collect | hazard_hit | sample_collected
    simulation_time_s: float
    battery: float


@dataclass(frozen=True)
class ActionResult:
    success: bool
    message: str


@dataclass
class JudgeEngine:
    scenario: Scenario
    config: JudgeConfig
    noise_rng: random.Random = field(default=None)
    schedule: Optional[EventSchedule] = None
    shared_remaining: Optional[List[Point]] = None  # общий список образцов команды
    battery: float = 0.0
    collected: int = 0
    collisions: int = 0
    false_collects: int = 0
    finished: bool = False
    finish_success: bool = False
    simulation_time_s: float = 0.0
    events: List[JudgeEvent] = field(default_factory=list)
    _remaining: List[Point] = field(default_factory=list)
    _last_pose: Optional[Tuple[float, float, float]] = None
    _pose: Optional[Point] = None
    _last_time_s: Optional[float] = None
    _in_hazard: bool = False
    _last_signal: float = 0.0

    def __post_init__(self):
        if self.noise_rng is None:
            self.noise_rng = random.Random(self.scenario.seed + 1)
        self.battery = self.config.battery_initial
        self._remaining = (self.shared_remaining if self.shared_remaining is not None
                           else list(self.scenario.samples))

    @property
    def depleted(self) -> bool:
        return self.battery <= 0.0

    @property
    def active(self) -> bool:
        return not self.finished and not self.depleted

    def update_pose(self, x_m: float, y_m: float, heading_rad: float, simulation_time_s: float):
        """Принимает фактическое положение в мировых координатах и списывает расход."""
        self.simulation_time_s = simulation_time_s
        self._pose = (x_m, y_m)
        if self._last_pose is not None and self.active:
            last_x, last_y, last_heading = self._last_pose
            distance = math.hypot(x_m - last_x, y_m - last_y)
            if distance <= self.config.pose_jump_limit_m:
                self._spend(self._travel_cost((last_x, last_y), (x_m, y_m), distance))
                turn = abs(math.atan2(math.sin(heading_rad - last_heading),
                                      math.cos(heading_rad - last_heading)))
                self._spend(turn * self.config.rotation_energy_per_rad)
            if self._last_time_s is not None and simulation_time_s > self._last_time_s:
                self._spend((simulation_time_s - self._last_time_s) * self.config.idle_energy_per_s)
        self._check_hazard((x_m, y_m), simulation_time_s)
        self._last_pose = (x_m, y_m, heading_rad)
        self._last_time_s = simulation_time_s

    def _check_hazard(self, point: Point, simulation_time_s: float):
        hazard = self.schedule.hazard_at(simulation_time_s) if self.schedule else None
        inside = hazard is not None and hazard.contains(point)
        if inside and not self._in_hazard and self.active:
            self._spend(self.config.hazard_penalty_energy)
            self._record("hazard_hit")
        self._in_hazard = inside

    def _travel_cost(self, start: Point, end: Point, distance: float) -> float:
        midpoint = ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0)
        in_soil = any(zone.contains(midpoint) for zone in self.soil_zones())
        per_metre = self.config.energy_per_m + (self.config.soil_surcharge_per_m if in_soil else 0.0)
        return distance * per_metre

    def soil_zones(self):
        if self.schedule is None:
            return self.scenario.soil_zones
        return self.schedule.soil_zones_at(self.scenario, self.simulation_time_s)

    def _spend(self, amount: float):
        self.battery = max(0.0, self.battery - amount)

    def sample_signal(self) -> Optional[float]:
        """Шумная близость к ближайшему несобранному образцу, 0..1; None — датчик молчит."""
        fault = self.schedule.sensor_fault_at(self.simulation_time_s) if self.schedule else None
        if fault is not None and fault.kind == SENSOR_DROPOUT:
            return None
        if fault is not None and fault.kind == SENSOR_STUCK:
            return self._last_signal
        if self._pose is None or not self._remaining:
            return 0.0
        nearest = min(math.dist(self._pose, sample) for sample in self._remaining)
        clean = math.exp(-nearest / self.config.sensor_decay_length_m)
        sigma = (self.config.sensor_noisy_sigma if fault is not None and fault.kind == SENSOR_NOISY
                 else self.config.sensor_noise_sigma)
        self._last_signal = min(1.0, max(0.0, clean + self.noise_rng.gauss(0.0, sigma)))
        return self._last_signal

    def register_collision(self):
        if not self.active:
            return
        self.collisions += 1
        self._spend(self.config.collision_penalty_energy)
        self._record("collision")

    def collect(self) -> ActionResult:
        if not self.active or self._pose is None:
            return ActionResult(False, "mission_not_active")
        for sample in self._remaining:
            if math.dist(self._pose, sample) < self.config.collect_radius_m:
                self._remaining.remove(sample)
                self.collected += 1
                self._record("sample_collected")
                return ActionResult(True, "collected")
        self.false_collects += 1
        self._spend(self.config.false_collect_penalty_energy)
        self._record("false_collect")
        return ActionResult(False, "no_sample_in_range")

    def finish(self) -> ActionResult:
        if self.finished:
            return ActionResult(self.finish_success, "already_finished")
        if self.depleted:
            return ActionResult(False, "battery_depleted")
        at_base = (self._pose is not None
                   and math.dist(self._pose, self.config.base_world_m) <= self.config.finish_radius_m)
        self.finished = True
        self.finish_success = at_base
        return ActionResult(at_base, "finished" if at_base else "not_at_base")

    def score(self) -> float:
        return (self.collected * self.config.score_per_sample
                - self.collisions * self.config.score_per_collision
                - self.false_collects * self.config.score_per_false_collect)

    def state_label(self) -> str:
        if self.finished:
            return "finished"
        return "depleted" if self.depleted else "running"

    def _record(self, kind: str):
        self.events.append(JudgeEvent(kind, self.simulation_time_s, self.battery))
