"""Тестовые двойники портов: кинематический мир, часы, судья и планировщики."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from application.ports import JudgeReply, PlannerError
from domain.geometry import Point, Pose, distance_m
from domain.grid import OccupancyGrid
from domain.observations import Observation
from domain.subgoals import PlanningContext, Subgoal


class FakeClock:
    def __init__(self) -> None:
        self.now_s = 100.0

    def monotonic_s(self) -> float:
        return self.now_s


def build_arena() -> OccupancyGrid:
    """8x6 м, шаг 0.1 м, рамка и столб; origin (-4, -3)."""
    width, height = 80, 60
    cells = [0] * (width * height)
    for row in range(height):
        for column in range(width):
            wall = column in (0, width - 1) or row in (0, height - 1)
            pillar = 38 <= column <= 41 and 33 <= row <= 36  # столб около (0, 0.5)
            if wall or pillar:
                cells[row * width + column] = 100
    return OccupancyGrid("test-arena", 0.1, width, height, Pose(-4.0, -3.0, 0.0), cells)


@dataclass
class Zone:
    center: Point
    radius_m: float
    energy_per_m: float


class SimWorld:
    """Кинематика робота + скрытые образцы + расход батареи. Ядро видит только Observation."""

    def __init__(self, clock: FakeClock, samples: list[Point], zones: list[Zone] | None = None,
                 start: Pose = Pose(-2.0, -0.5, 0.0), battery: float = 60.0, base_energy_per_m: float = 1.0,
                 signal_noise: float = 0.02, seed: int = 0) -> None:
        self.clock = clock
        self._initial_samples = list(samples)
        self.zones = zones or []
        self.start = start
        self.battery_initial = battery
        self.base_energy_per_m = base_energy_per_m
        self.signal_noise = signal_noise
        self.random = random.Random(seed)
        self.linear = 0.0
        self.angular = 0.0
        self.stop_calls = 0
        self.reset_calls = 0
        self.penalty = False
        self.frozen = False  # заморозить датчики (имитация потери odom)
        self._apply_reset()

    def _apply_reset(self) -> None:
        self.pose = self.start
        self.battery = self.battery_initial
        self.remaining = list(self._initial_samples)
        self.collected = 0
        self.finished = False
        self.linear = self.angular = 0.0
        self.last_received_s = self.clock.now_s

    # SimulationControl
    def reset(self, scenario: str, seed: int) -> None:
        self.reset_calls += 1
        self._apply_reset()

    # VelocityDrive
    def command(self, linear_mps: float, angular_radps: float) -> None:
        self.linear, self.angular = linear_mps, angular_radps

    def stop(self) -> None:
        self.stop_calls += 1
        self.linear = self.angular = 0.0

    def energy_per_m_at(self, point: Point) -> float:
        for zone in self.zones:
            if distance_m(point, zone.center) <= zone.radius_m:
                return zone.energy_per_m
        return self.base_energy_per_m

    def advance(self, dt_s: float = 0.1) -> None:
        self.clock.now_s += dt_s
        heading = self.pose.heading_rad + self.angular * dt_s
        step = self.linear * dt_s
        new = Pose(self.pose.x_m + step * math.cos(heading), self.pose.y_m + step * math.sin(heading), heading)
        self.battery = max(0.0, self.battery - step * self.energy_per_m_at(new.point))
        self.pose = new
        if not self.frozen:
            self.last_received_s = self.clock.now_s

    # ObservationSource
    def latest(self) -> Observation | None:
        nearest = min((distance_m(self.pose.point, s) for s in self.remaining), default=None)
        signal = None
        if nearest is not None:
            signal = min(1.0, max(0.0, 1 - nearest / 1.5 + self.random.gauss(0, self.signal_noise)))
        return Observation(
            simulation_time_s=self.clock.now_s, pose=self.pose, battery_remaining=self.battery,
            sample_signal=signal, received_monotonic_s=self.last_received_s, penalty_recent=self.penalty,
        )

    # JudgeClient
    def collect(self) -> JudgeReply:
        for sample in self.remaining:
            if distance_m(self.pose.point, sample) < 0.30:
                self.remaining.remove(sample)
                self.collected += 1
                return JudgeReply(True)
        return JudgeReply(False, "false_collect")

    def finish(self) -> JudgeReply:
        self.finished = True
        at_base = distance_m(self.pose.point, self.start.point) < 0.5
        return JudgeReply(at_base and self.battery > 0)


class FailingResetSimulation:
    def reset(self, scenario: str, seed: int) -> None:
        raise RuntimeError("ROS не перезапустился")


class ScriptedPlanner:
    """Возвращает заданные подцели по очереди; Exception в списке — отказ планировщика."""

    def __init__(self, script: list, on_call=None) -> None:
        self._script = list(script)
        self.calls = 0
        self._on_call = on_call

    def propose(self, context: PlanningContext, is_cancelled) -> Subgoal:
        self.calls += 1
        if self._on_call:
            self._on_call()
        if not self._script:
            raise PlannerError("сценарий исчерпан")
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@dataclass
class FakeEnvironment:
    judge_mode: str = "local"
    ros: bool = True
    llm: bool = False

    def ros_connected(self) -> bool:
        return self.ros

    def llm_available(self) -> bool:
        return self.llm


@dataclass
class StaticMap:
    grid: OccupancyGrid | None = field(default_factory=build_arena)

    def load(self) -> OccupancyGrid | None:
        return self.grid


def planner_error(message: str = "сбой") -> PlannerError:
    return PlannerError(message)
