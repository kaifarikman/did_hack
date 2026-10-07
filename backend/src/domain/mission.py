"""Миссия: состояние, допустимые переходы и неизменяемые снимки.

Мутации защищены блокировкой: Stop приходит из HTTP-потока, тики — из потока исполнения.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from enum import Enum

from domain.errors import InvalidTransition
from domain.geometry import Point, Pose
from domain.plans import MissionPlan, StepStatus
from domain.subgoals import Subgoal

TRAJECTORY_LIMIT = 500


class MissionStatus(str, Enum):
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    RETURNING = "returning"
    STOPPING = "stopping"
    COMPLETED = "completed"
    STOPPED = "stopped"
    FAILED = "failed"

    @property
    def is_terminal(self) -> bool:
        return self in (MissionStatus.COMPLETED, MissionStatus.STOPPED, MissionStatus.FAILED)

    @property
    def is_active(self) -> bool:
        return self not in (MissionStatus.IDLE, *_TERMINAL)


_TERMINAL = (MissionStatus.COMPLETED, MissionStatus.STOPPED, MissionStatus.FAILED)

_ALLOWED = {
    MissionStatus.STARTING: {MissionStatus.RUNNING, MissionStatus.STOPPING, MissionStatus.FAILED},
    MissionStatus.RUNNING: {MissionStatus.RETURNING, MissionStatus.STOPPING, MissionStatus.FAILED},
    MissionStatus.RETURNING: {
        MissionStatus.COMPLETED,
        MissionStatus.STOPPING,
        MissionStatus.FAILED,
    },
    MissionStatus.STOPPING: {MissionStatus.STOPPED, MissionStatus.FAILED},
}


@dataclass(frozen=True)
class MissionError:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True)
class CollectedSample:
    sample_id: str
    position: Point


@dataclass(frozen=True)
class TerrainEstimateView:
    region_id: str
    center: Point
    radius_m: float
    energy_per_m: float
    confidence: float
    std_energy_per_m: float = 0.0
    regime: int = 0
    last_measured_s: float | None = None


@dataclass(frozen=True)
class MissionSnapshot:
    run_id: str | None
    revision: int
    status: MissionStatus
    scenario: str | None
    seed: int | None
    judge_mode: str
    planner_mode: str
    simulation_time_s: float | None
    map_id: str | None
    robot_pose: Pose | None
    base_position: Point | None
    battery_remaining: float | None
    battery_initial: float
    sample_signal: float | None
    samples_collected: int
    return_energy_estimate: float | None
    current_goal: Subgoal | None
    trajectory: tuple[Point, ...]
    planned_path: tuple[Point, ...]
    collected_samples: tuple[CollectedSample, ...]
    terrain_estimates: tuple[TerrainEstimateView, ...]
    last_error: MissionError | None
    mission_text: str = ""
    target_samples: int | None = None
    map_mode: str = "static"
    plan: MissionPlan | None = None
    plan_statuses: tuple[StepStatus, ...] = ()
    plan_revision_reason: str | None = None
    research: "ResearchView" = None  # type: ignore[assignment]


@dataclass(frozen=True)
class HazardView:
    detection_id: str
    center: Point
    radius_m: float
    hits: int


@dataclass(frozen=True)
class HypothesisView:
    hypothesis_id: str
    kind: str
    status: str
    center: Point
    prediction: str
    measurement: str | None
    detection_id: str | None
    experiment_id: str | None


@dataclass(frozen=True)
class ResearchView:
    """Оценки агента для панели: состояние датчика, опасности, гипотезы. Не истина сценария."""

    sensor_state: str = "ok"
    sensor_fault: str | None = None
    sensor_quality: float = 1.0
    hazards: tuple[HazardView, ...] = ()
    hypotheses: tuple[HypothesisView, ...] = ()
    last_replan_reason: str | None = None
    last_replan_detection_id: str | None = None
    planner_requests: int = 0


class Mission:
    def __init__(
        self,
        run_id: str,
        scenario: str,
        seed: int,
        judge_mode: str,
        planner_mode: str,
        map_id: str | None,
        base: Point,
        battery_initial: float,
        generation: int = 1,
        mission_text: str = "",
        target_samples: int | None = None,
        map_mode: str = "static",
    ) -> None:
        self._lock = threading.RLock()
        self.run_id = run_id
        self.scenario = scenario
        self.seed = seed
        self.generation = generation  # поколение прогона: наблюдения и ответы других поколений отбрасываются
        self.mission_text = mission_text
        self.map_mode = map_mode
        self.target_samples = target_samples
        self._plan: MissionPlan | None = None
        self._plan_statuses: tuple[StepStatus, ...] = ()
        self._plan_revision_reason: str | None = None
        self._research_view: ResearchView = ResearchView()
        self._judge_mode = judge_mode
        self._planner_mode = planner_mode
        self._map_id = map_id
        self._base = base
        self._battery_initial = battery_initial
        self._status = MissionStatus.STARTING
        self._revision = 0
        self._simulation_time_s: float | None = None
        self._pose: Pose | None = None
        self._battery: float | None = None
        self._signal: float | None = None
        self._return_estimate: float | None = None
        self._goal: Subgoal | None = None
        self._trajectory: list[Point] = []
        self._planned_path: tuple[Point, ...] = ()
        self._collected: list[CollectedSample] = []
        self._terrain: tuple[TerrainEstimateView, ...] = ()
        self._error: MissionError | None = None

    @property
    def status(self) -> MissionStatus:
        return self._status

    @property
    def samples_collected(self) -> int:
        return len(self._collected)

    @property
    def stop_requested(self) -> bool:
        return self._status is MissionStatus.STOPPING

    def _transition(self, target: MissionStatus) -> None:
        if target not in _ALLOWED.get(self._status, set()):
            raise InvalidTransition(f"{self._status.value} -> {target.value}")
        self._status = target
        if target.is_terminal:  # после завершения нет «текущей» цели: последняя цель не выдаётся за активную
            self._goal, self._planned_path = None, ()
        self._revision += 1

    def mark_running(self) -> None:
        with self._lock:
            self._transition(MissionStatus.RUNNING)

    def begin_return(self) -> None:
        with self._lock:
            if self._status is MissionStatus.RETURNING:
                return
            self._transition(MissionStatus.RETURNING)

    def request_stop(self) -> None:
        """Идемпотентно: повторный Stop и Stop терминального прогона не имеют эффекта."""
        with self._lock:
            if self._status.is_terminal or self._status is MissionStatus.STOPPING:
                return
            self._transition(MissionStatus.STOPPING)

    def confirm_stopped(self) -> None:
        with self._lock:
            self._transition(MissionStatus.STOPPED)

    def complete(self, finish_confirmed: bool) -> None:
        """Успех только при подтверждённом сборе, положительной батарее и ответе судьи."""
        with self._lock:
            if not finish_confirmed:
                raise InvalidTransition("судья не подтвердил завершение")
            if not self._collected:
                raise InvalidTransition("нет подтверждённого сбора")
            if self._battery is None or self._battery <= 0:
                raise InvalidTransition("батарея не положительна")
            self._transition(MissionStatus.COMPLETED)

    def fail(self, error: MissionError) -> None:
        with self._lock:
            if self._status.is_terminal:
                return
            self._error = error
            self._transition(MissionStatus.FAILED)

    def update_telemetry(
        self,
        simulation_time_s: float | None,
        pose: Pose | None,
        battery_remaining: float | None,
        sample_signal: float | None,
    ) -> None:
        with self._lock:
            if self._status.is_terminal:
                return
            self._simulation_time_s = simulation_time_s
            self._pose = pose
            self._battery = battery_remaining
            self._signal = sample_signal
            if pose is not None:
                point = pose.point
                if not self._trajectory or self._trajectory[-1] != point:
                    self._trajectory.append(point)
                    del self._trajectory[:-TRAJECTORY_LIMIT]
            self._revision += 1

    def set_goal(self, goal: Subgoal | None, planned_path: tuple[Point, ...] = ()) -> None:
        with self._lock:
            if self._status.is_terminal:
                return
            self._goal = goal
            self._planned_path = planned_path
            if goal is not None:
                self._planner_mode = goal.source
            self._revision += 1

    def set_map_id(self, map_id: str | None) -> None:
        """SLAM: карта появляется и меняет идентификатор по ходу прогона."""
        with self._lock:
            if self._status.is_terminal or map_id == self._map_id:
                return
            self._map_id = map_id
            self._revision += 1

    def set_return_estimate(self, estimate: float | None) -> None:
        with self._lock:
            self._return_estimate = estimate
            self._revision += 1

    def set_plan(self, plan: MissionPlan, statuses: tuple[StepStatus, ...], revision_reason: str | None) -> None:
        with self._lock:
            if self._status.is_terminal:
                return
            self._plan, self._plan_statuses, self._plan_revision_reason = plan, statuses, revision_reason
            self._revision += 1

    def set_research(self, view: "ResearchView") -> None:
        with self._lock:
            if self._status.is_terminal or view == self._research_view:
                return
            self._research_view = view
            self._revision += 1

    def set_terrain(self, terrain: tuple[TerrainEstimateView, ...]) -> None:
        with self._lock:
            self._terrain = terrain
            self._revision += 1

    def add_collected_sample(self, position: Point) -> CollectedSample:
        with self._lock:
            sample = CollectedSample(f"sample-{len(self._collected) + 1}", position)
            self._collected.append(sample)
            self._revision += 1
            return sample

    def snapshot(self) -> MissionSnapshot:
        with self._lock:
            return MissionSnapshot(
                run_id=self.run_id,
                revision=self._revision,
                status=self._status,
                scenario=self.scenario,
                seed=self.seed,
                judge_mode=self._judge_mode,
                planner_mode=self._planner_mode,
                simulation_time_s=self._simulation_time_s,
                robot_pose=self._pose,
                base_position=self._base,
                battery_remaining=self._battery,
                battery_initial=self._battery_initial,
                sample_signal=self._signal,
                samples_collected=len(self._collected),
                return_energy_estimate=self._return_estimate,
                current_goal=self._goal,
                trajectory=tuple(self._trajectory),
                planned_path=self._planned_path,
                collected_samples=tuple(self._collected),
                terrain_estimates=self._terrain,
                last_error=self._error,
                mission_text=self.mission_text,
                target_samples=self.target_samples,
                map_mode=self.map_mode,
                map_id=self._map_id,
                plan=self._plan,
                plan_statuses=self._plan_statuses,
                plan_revision_reason=self._plan_revision_reason,
                research=self._research_view,
            )
