"""Исполнитель движения: единственный, кто отдаёт команды скорости."""
from __future__ import annotations

from enum import Enum

from application.ports import VelocityDrive
from domain.geometry import Point, Pose, distance_m
from domain.navigation import PathTracker, StuckDetector


class MotionState(str, Enum):
    IDLE = "idle"
    MOVING = "moving"
    ARRIVED = "arrived"
    STUCK = "stuck"


class MotionExecutor:
    def __init__(self, drive: VelocityDrive, stuck_detector: StuckDetector, tolerance_m: float) -> None:
        self._drive = drive
        self._stuck = stuck_detector
        self._tolerance = tolerance_m
        self._tracker: PathTracker | None = None

    @property
    def active(self) -> bool:
        return self._tracker is not None

    def follow(self, waypoints: list[Point]) -> None:
        self._tracker = PathTracker(waypoints, self._tolerance)
        self._stuck.reset()

    def step(self, pose: Pose, now_s: float) -> MotionState:
        if self._tracker is None:
            return MotionState.IDLE
        command = self._tracker.next_command(pose)
        if command is None:
            self.stop()
            return MotionState.ARRIVED
        goal = self._tracker.goal
        if goal is not None and self._stuck.is_stuck(distance_m(pose.point, goal), now_s):
            self.stop()
            return MotionState.STUCK
        self._drive.command(command.linear_mps, command.angular_radps)
        return MotionState.MOVING

    def hold(self) -> None:
        """Пауза без отмены пути (уступаем партнёру): ожидание не считается застреванием."""
        self._stuck.reset()
        self._drive.stop()

    def stop(self) -> None:
        """Останавливает всегда, даже без активного пути; восстановление связи не возобновляет путь."""
        self._tracker = None
        self._drive.stop()
