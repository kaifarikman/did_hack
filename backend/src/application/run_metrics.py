"""One controller owns one accumulator; snapshots are immutable and bounded."""
from __future__ import annotations

import math
from collections import deque

from domain.geometry import distance_m
from domain.mission import MissionSnapshot
from domain.run_metrics import MetricPoint, PlannerMetrics, RunMetricsSummary, RunMetricsView

HISTORY_LIMIT = 180
SAMPLE_INTERVAL_S = 1.0
MAX_OBSERVATION_GAP_S = 2.0


class RunMetrics:
    def __init__(self, reserve_energy: float, pose_jump_m: float) -> None:
        self._reserve = reserve_energy
        self._pose_jump = pose_jump_m
        self._identity = None
        self._previous: MissionSnapshot | None = None
        self._previous_wall: float | None = None
        self._started_wall: float | None = None
        self._started_sim: float | None = None
        self._distance = 0.0
        self._phases = dict.fromkeys(("moving", "turning", "planning", "stationary", "unknown"), 0.0)
        self._history: deque[MetricPoint] = deque(maxlen=HISTORY_LIMIT)
        self._view: RunMetricsView | None = None
        self._pending_gap = False

    @property
    def view(self) -> RunMetricsView | None:
        return self._view

    def observe(self, snapshot: MissionSnapshot, wall_s: float, waiting: bool,
                planner: PlannerMetrics) -> RunMetricsView | None:
        identity = (snapshot.run_id, snapshot.robot_id, snapshot.generation)
        if snapshot.run_id is None or snapshot.generation is None:
            return self._view
        if self._identity is None:
            self._identity = identity
        if identity != self._identity:
            return self._view
        previous = self._previous
        if previous is not None:
            sequence, old_sequence = snapshot.observation_sequence, previous.observation_sequence
            if sequence is not None and old_sequence is not None and sequence <= old_sequence:
                return self._view
        moment = snapshot.simulation_time_s
        if moment is None or not math.isfinite(moment):
            return self._view
        if previous is not None and moment <= previous.simulation_time_s:
            return self._view
        if self._started_wall is None:
            self._started_wall, self._started_sim = wall_s, moment
        speed, phase, continuous = None, "unknown", False
        fresh = all(source.fresh is not False for source in
                    (snapshot.freshness.odom, snapshot.freshness.battery, snapshot.freshness.clock))
        if previous is not None:
            elapsed = moment - previous.simulation_time_s
            wall_gap = wall_s - self._previous_wall
            previous_fresh = all(source.fresh is not False for source in
                                 (previous.freshness.odom, previous.freshness.battery, previous.freshness.clock))
            if fresh and previous_fresh and snapshot.robot_pose is not None and previous.robot_pose is not None:
                distance = distance_m(snapshot.robot_pose.point, previous.robot_pose.point)
                continuous = (elapsed <= MAX_OBSERVATION_GAP_S and 0 < wall_gap <= MAX_OBSERVATION_GAP_S
                              and distance <= self._pose_jump)
                if continuous:
                    self._distance += distance
                    speed = distance / elapsed
                    turn = abs(math.atan2(math.sin(snapshot.robot_pose.heading_rad - previous.robot_pose.heading_rad),
                                          math.cos(snapshot.robot_pose.heading_rad - previous.robot_pose.heading_rad)))
                    phase = "moving" if speed > 0.01 else "turning" if turn / elapsed > 0.05 else "planning" if waiting else "stationary"
            self._phases[phase] += elapsed
        available = None
        if snapshot.battery_remaining is not None and snapshot.return_energy_estimate is not None:
            available = snapshot.battery_remaining - snapshot.return_energy_estimate - self._reserve
        elapsed_wall, elapsed_sim = max(0.0, wall_s - self._started_wall), moment - self._started_sim
        summary = RunMetricsSummary(
            snapshot.run_id, snapshot.robot_id, snapshot.generation, snapshot.observation_sequence, moment,
            self._distance, speed, self._reserve, available, elapsed_sim, elapsed_wall,
            elapsed_sim / elapsed_wall if elapsed_wall > 0 else None, phase, tuple(self._phases.items()), planner,
        )
        self._pending_gap = self._pending_gap or not continuous
        if not self._history or moment - self._history[-1].simulation_time_s >= SAMPLE_INTERVAL_S:
            self._history.append(MetricPoint(moment, snapshot.battery_remaining, snapshot.return_energy_estimate,
                                             snapshot.sample_signal, speed, phase, not self._pending_gap))
            self._pending_gap = False
        self._previous, self._previous_wall = snapshot, wall_s
        self._view = RunMetricsView(summary, tuple(self._history), HISTORY_LIMIT, SAMPLE_INTERVAL_S)
        return self._view
