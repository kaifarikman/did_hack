"""Тестовые двойники портов: кинематический мир, часы, судья и планировщики."""
from __future__ import annotations

import math
import random
from concurrent.futures import Executor, Future
from dataclasses import dataclass, field

from application.ports import JudgeReply, OperationOutcome, PlannerError, PublicScore, ResetAck, ResetRequest
from domain.events import EventKind, PublicEvent
from domain.geometry import Point, Pose, distance_m
from domain.grid import OccupancyGrid
from domain.observations import LocalizationStatus, Observation
from domain.plans import MissionPlan, single_step_plan
from domain.subgoals import PlanningContext, Subgoal


def signal_strength(distance: float) -> float:
    """Чистый сигнал как у локального судьи: exp(−d / 1.5)."""
    return math.exp(-distance / 1.5)


class SynchronousExecutor(Executor):
    """Выполняет задачу сразу: ответ планировщика детерминированно готов к следующему тику."""

    def submit(self, fn, /, *args, **kwargs) -> Future:
        future: Future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as error:  # noqa: BLE001 — ошибка передаётся через Future, как в пуле
            future.set_exception(error)
        return future


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
    """Кинематика робота + скрытые образцы + расход батареи. Ядро видит только Observation.

    Скрытые изменения hard задаются расписанием `schedule` по времени после сброса: смена стоимости
    зоны, новая опасность, режим sample-датчика. Ядро узнаёт о них только по наблюдениям и событиям.
    """

    def __init__(self, clock: FakeClock, samples: list[Point], zones: list[Zone] | None = None,
                 start: Pose = Pose(-2.0, -0.5, 0.0), battery: float = 60.0, base_energy_per_m: float = 1.0,
                 signal_noise: float = 0.02, seed: int = 0, rotation_energy_per_rad: float = 0.0,
                 hazards: list[Zone] | None = None, hazard_penalty: float = 1.0,
                 schedule: list[tuple[float, "WorldChange"]] | None = None) -> None:
        self.clock = clock
        self._initial_samples = list(samples)
        self._initial_zones = [Zone(z.center, z.radius_m, z.energy_per_m) for z in zones or []]
        self._initial_hazards = list(hazards or [])
        self._schedule = sorted(schedule or [], key=lambda item: item[0])
        self.start = start
        self.battery_initial = battery
        self.base_energy_per_m = base_energy_per_m
        self.base_signal_noise = signal_noise
        self.rotation_energy_per_rad = rotation_energy_per_rad
        self.hazard_penalty = hazard_penalty
        self.seed = seed
        self.linear = 0.0
        self.angular = 0.0
        self.stop_calls = 0
        self.reset_calls = 0
        self.penalty = False
        self.frozen = False  # заморозить датчики (имитация потери odom)
        self.generation: int | None = None
        self.localization = LocalizationStatus.OK
        self._apply_reset()

    def _apply_reset(self) -> None:
        self.random = random.Random(self.seed)
        self.pose = self.start
        self.battery = self.battery_initial
        self.remaining = list(self._initial_samples)
        self.zones = [Zone(z.center, z.radius_m, z.energy_per_m) for z in self._initial_zones]
        self.hazards = list(self._initial_hazards)
        self.pending_changes = list(self._schedule)
        self.applied_changes: list[tuple[float, str]] = []  # закрытый журнал для оценки в тестах
        self.zone_travel: list[tuple[float, int, float]] = []  # (время, индекс зоны, путь) — для оценщика
        self.reset_at_s = self.clock.now_s
        self.signal_noise = self.base_signal_noise
        self.sensor_mode = "ok"
        self._stuck_signal: float | None = None
        self._inside_hazard = False
        self.collected = 0
        self.finished = False
        self.finish_success: bool | None = None
        self.events: list[PublicEvent] = []
        self.linear = self.angular = 0.0
        self.last_received_s = self.clock.now_s

    @property
    def elapsed_s(self) -> float:
        return self.clock.now_s - self.reset_at_s

    def set_sensor(self, mode: str, noise: float | None = None) -> None:
        """ok | noisy | stuck | dropout."""
        self.sensor_mode = mode
        self.signal_noise = noise if noise is not None else self.base_signal_noise
        self._stuck_signal = None

    # SimulationControl
    def reset(self, request: ResetRequest) -> ResetAck:
        self.reset_calls += 1
        self.last_reset = request
        self.generation = request.generation
        self._apply_reset()
        return ResetAck(request.generation, request.scenario, request.seed, request.map_mode, request.robot_ids)

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
        while self.pending_changes and self.pending_changes[0][0] <= self.elapsed_s:
            at_s, change = self.pending_changes.pop(0)
            change.apply(self)
            self.applied_changes.append((self.clock.now_s, change.label))
        heading = self.pose.heading_rad + self.angular * dt_s
        step = self.linear * dt_s
        new = Pose(self.pose.x_m + step * math.cos(heading), self.pose.y_m + step * math.sin(heading), heading)
        spent = step * self.energy_per_m_at(new.point) + abs(self.angular * dt_s) * self.rotation_energy_per_rad
        for index, zone in enumerate(self.zones):
            if step > 0 and distance_m(new.point, zone.center) <= zone.radius_m:
                self.zone_travel.append((self.clock.now_s, index, step))
        self.battery = max(0.0, self.battery - spent)
        self.pose = new
        self._check_hazards()
        if not self.frozen:
            self.last_received_s = self.clock.now_s

    def _check_hazards(self) -> None:
        inside = any(distance_m(self.pose.point, zone.center) <= zone.radius_m for zone in self.hazards)
        if inside and not self._inside_hazard:
            self.battery = max(0.0, self.battery - self.hazard_penalty)
            self.emit(EventKind.HAZARD_HIT)
        self._inside_hazard = inside

    def _sensor_reading(self) -> float | None:
        if self.sensor_mode == "dropout":
            return None
        nearest = min((distance_m(self.pose.point, s) for s in self.remaining), default=None)
        if nearest is None:
            return 0.0  # как локальный судья: образцов не осталось — сигнал 0, а не пропадание
        value = min(1.0, max(0.0, signal_strength(nearest) + self.random.gauss(0, self.signal_noise)))
        if self.sensor_mode == "stuck":
            if self._stuck_signal is None:
                self._stuck_signal = value
            return self._stuck_signal
        return value

    # ObservationSource
    def latest(self) -> Observation | None:
        signal = self._sensor_reading()
        return Observation(
            simulation_time_s=self.clock.now_s, pose=self.pose, battery_remaining=self.battery,
            sample_signal=signal, received_monotonic_s=self.last_received_s, penalty_recent=self.penalty,
            generation=self.generation, localization=self.localization,
        )

    # EventSource
    def emit(self, kind: EventKind) -> None:
        self.events.append(PublicEvent(len(self.events) + 1, kind, self.clock.now_s, generation=self.generation,
                                       position=self.pose.point, battery_after=self.battery))

    def events_after(self, sequence: int) -> list[PublicEvent]:
        return [event for event in self.events if event.sequence > sequence]

    # ScoreSource
    def score(self) -> PublicScore:
        return PublicScore(self.collected, self.finished, self.finish_success, self.clock.now_s)

    # JudgeClient
    def collect(self) -> JudgeReply:
        for sample in self.remaining:
            if distance_m(self.pose.point, sample) < 0.30:
                self.remaining.remove(sample)
                self.collected += 1
                self.emit(EventKind.SAMPLE_COLLECTED)
                return JudgeReply(True)
        self.emit(EventKind.FALSE_COLLECT)
        return JudgeReply(False, "false_collect")

    def finish(self) -> JudgeReply:
        self.finished = True
        at_base = distance_m(self.pose.point, self.start.point) < 0.5
        self.finish_success = at_base and self.battery > 0
        return JudgeReply(self.finish_success)


class TimeoutJudge:
    """Судья выполняет операцию, но ответ теряется: исход для ядра неизвестен."""

    def __init__(self, world: SimWorld) -> None:
        self._world = world
        self.collect_calls = 0

    def collect(self) -> JudgeReply:
        self.collect_calls += 1
        self._world.collect()
        return JudgeReply(False, "судья не ответил вовремя", OperationOutcome.UNKNOWN)

    def finish(self) -> JudgeReply:
        self._world.finish()
        return JudgeReply(False, "судья не ответил вовремя", OperationOutcome.UNKNOWN)


@dataclass(frozen=True)
class WorldChange:
    """Скрытое изменение среды; label виден только тестам и оценщику, не ядру."""

    label: str
    zone_index: int | None = None
    zone_energy_per_m: float | None = None
    hazard: Zone | None = None
    sensor_mode: str | None = None
    sensor_noise: float | None = None

    def apply(self, world: "SimWorld") -> None:
        if self.zone_index is not None and self.zone_energy_per_m is not None:
            world.zones[self.zone_index].energy_per_m = self.zone_energy_per_m
        if self.hazard is not None:
            world.hazards.append(self.hazard)
        if self.sensor_mode is not None:
            world.set_sensor(self.sensor_mode, self.sensor_noise)


class FailingResetSimulation:
    def reset(self, request: ResetRequest) -> ResetAck:
        raise RuntimeError("ROS не перезапустился")


class ScriptedPlanner:
    """Возвращает заданные подцели по очереди; Exception в списке — отказ планировщика."""

    def __init__(self, script: list, on_call=None) -> None:
        self._script = list(script)
        self.calls = 0
        self.contexts: list[PlanningContext] = []
        self._on_call = on_call

    def propose(self, context: PlanningContext, is_cancelled) -> MissionPlan:
        """Подцель в сценарии становится планом из одного шага; MissionPlan возвращается как есть."""
        self.calls += 1
        self.contexts.append(context)
        if self._on_call:
            self._on_call()
        if not self._script:
            raise PlannerError("сценарий исчерпан")
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, MissionPlan):
            return item
        return single_step_plan(context, item, item.reason)


@dataclass
class FakeEnvironment:
    judge_mode: str = "local"
    ros: bool = True
    llm: bool = False
    scenarios: tuple[str, ...] = ("easy",)
    map_modes: tuple[str, ...] = ("static",)

    def ros_connected(self) -> bool:
        return self.ros

    def supported_map_modes(self) -> tuple[str, ...]:
        return self.map_modes

    def supported_scenarios(self) -> tuple[str, ...]:
        return self.scenarios

    def llm_available(self) -> bool:
        return self.llm


@dataclass
class StaticMap:
    grid: OccupancyGrid | None = field(default_factory=build_arena)

    def load(self) -> OccupancyGrid | None:
        return self.grid


def planner_error(message: str = "сбой") -> PlannerError:
    return PlannerError(message)


class GrowingMap:
    """Подменный SLAM: открывает клетки эталонной карты в радиусе обзора робота, остальное неизвестно.

    Каждое открытие новых клеток увеличивает `revision`; до первого обзора карты нет (None).
    """

    def __init__(self, truth: OccupancyGrid, pose_of, view_radius_m: float = 1.5, map_id: str = "slam-test") -> None:
        self._truth = truth
        self._pose_of = pose_of
        self._radius = view_radius_m
        self._map_id = map_id
        self._known: dict[int, int] = {}
        self.revision = 0
        self._grid: OccupancyGrid | None = None

    def observe(self) -> None:
        pose = self._pose_of()
        if pose is None:
            return
        truth, radius_cells = self._truth, math.ceil(self._radius / self._truth.resolution_m)
        center = truth.world_to_cell(pose.point)
        if center is None:
            return
        added = False
        for row in range(center[1] - radius_cells, center[1] + radius_cells + 1):
            for column in range(center[0] - radius_cells, center[0] + radius_cells + 1):
                if not truth.contains(column, row):
                    continue
                if math.hypot(column - center[0], row - center[1]) * truth.resolution_m > self._radius:
                    continue
                index = truth.index(column, row)
                if index not in self._known:
                    self._known[index] = truth.cells[index]
                    added = True
        if added:
            self.revision += 1
            cells = [self._known.get(i, -1) for i in range(truth.width * truth.height)]
            self._grid = OccupancyGrid(self._map_id, truth.resolution_m, truth.width, truth.height,
                                       truth.origin, cells, self.revision)

    def load(self) -> OccupancyGrid | None:
        return self._grid


class TeamWorld:
    """Два и более робота в одном мире: общие образцы и атомарный судья, раздельные батареи."""

    def __init__(self, clock: FakeClock, samples: list[Point], starts: dict[str, Pose], battery: float = 60.0,
                 seed: int = 0) -> None:
        self.clock = clock
        self.remaining = list(samples)
        self.collected_by: dict[str, int] = {robot_id: 0 for robot_id in starts}
        self.events: list[PublicEvent] = []
        self.robots = {
            robot_id: TeamRobot(self, robot_id, start, battery, random.Random(seed + index))
            for index, (robot_id, start) in enumerate(starts.items())
        }

    @property
    def total_collected(self) -> int:
        return sum(self.collected_by.values())

    def advance(self, dt_s: float = 0.1) -> None:
        self.clock.now_s += dt_s
        for robot in self.robots.values():
            robot.move(dt_s)

    def try_collect(self, robot: "TeamRobot") -> JudgeReply:
        """Атомарно: образец снимается с карты один раз, второй робот получает отказ."""
        for sample in self.remaining:
            if distance_m(robot.pose.point, sample) < 0.30:
                self.remaining.remove(sample)
                self.collected_by[robot.robot_id] += 1
                self._emit(robot, EventKind.SAMPLE_COLLECTED)
                return JudgeReply(True)
        self._emit(robot, EventKind.FALSE_COLLECT)
        return JudgeReply(False, "no_sample_in_range")

    def _emit(self, robot: "TeamRobot", kind: EventKind) -> None:
        self.events.append(PublicEvent(len(self.events) + 1, kind, self.clock.now_s, robot.robot_id,
                                       robot.generation, robot.pose.point, robot.battery))


class TeamRobot:
    """Порты одного робота команды: наблюдения, скорость, судья, события."""

    def __init__(self, world: TeamWorld, robot_id: str, start: Pose, battery: float, rng: random.Random) -> None:
        self.world, self.robot_id, self.start = world, robot_id, start
        self.pose, self.battery, self.random = start, battery, rng
        self.linear = self.angular = 0.0
        self.generation: int | None = None
        self.finished = False
        self.alive = True  # False — процесс робота потерян: наблюдения перестают обновляться
        self.last_received_s = world.clock.now_s

    def move(self, dt_s: float) -> None:
        if not self.alive:
            return
        heading = self.pose.heading_rad + self.angular * dt_s
        step = self.linear * dt_s
        self.pose = Pose(self.pose.x_m + step * math.cos(heading), self.pose.y_m + step * math.sin(heading), heading)
        self.battery = max(0.0, self.battery - step)
        self.last_received_s = self.world.clock.now_s

    def reset(self, request: ResetRequest) -> ResetAck:
        self.generation = request.generation
        return ResetAck(request.generation, request.scenario, request.seed, request.map_mode, request.robot_ids)

    def command(self, linear_mps: float, angular_radps: float) -> None:
        self.linear, self.angular = linear_mps, angular_radps

    def stop(self) -> None:
        self.linear = self.angular = 0.0

    def latest(self) -> Observation:
        nearest = min((distance_m(self.pose.point, s) for s in self.world.remaining), default=None)
        signal = 0.0 if nearest is None else min(1.0, max(0.0, signal_strength(nearest) + self.random.gauss(0, 0.02)))
        return Observation(self.world.clock.now_s, self.pose, self.battery, signal, self.last_received_s,
                           robot_id=self.robot_id, generation=self.generation)

    def collect(self) -> JudgeReply:
        return self.world.try_collect(self)

    def finish(self) -> JudgeReply:
        self.finished = True
        return JudgeReply(distance_m(self.pose.point, self.start.point) < 0.5 and self.battery > 0)

    def events_after(self, sequence: int) -> list[PublicEvent]:
        return [event for event in self.world.events if event.sequence > sequence]
