"""Исполнитель движения: единственный, кто отдаёт команды скорости."""
from __future__ import annotations

import math
from enum import Enum
from typing import Callable

from application.ports import VelocityDrive
from domain.geometry import Point, Pose, normalize_angle
from domain.navigation import PathDeviationDetector, PathTracker, StuckDetector, VelocityCommand


ALIGN_TURN_MIN_RADPS = 0.1  # меньшая ошибка курса доворотом не исправить: препятствие действительно впереди


class MotionState(str, Enum):
    IDLE = "idle"
    MOVING = "moving"
    ARRIVED = "arrived"
    STUCK = "stuck"
    BLOCKED = "blocked"
    OFF_PATH = "off_path"
    RECOVERING = "recovering"
    RECOVERED = "recovered"
    RECOVERY_FAILED = "recovery_failed"


class MotionExecutor:
    def __init__(self, drive: VelocityDrive, stuck_detector: StuckDetector, tolerance_m: float,
                 path_deviation_tolerance_m: float = 0.30,
                 path_deviation_hysteresis_m: float = 0.05,
                 path_deviation_confirmation_s: float = 0.60,
                 path_replan_cooldown_s: float = 2.0) -> None:
        self._drive = drive
        self._stuck = stuck_detector
        self._tolerance = tolerance_m
        self._tracker: PathTracker | None = None
        self._deviation = PathDeviationDetector(
            path_deviation_tolerance_m, path_deviation_hysteresis_m,
            path_deviation_confirmation_s, path_replan_cooldown_s,
        )
        self._recovery_phase: str | None = None
        self._recovery_started_s = 0.0
        self._recovery_start_pose: Pose | None = None
        self._recovery_phase_heading_rad = 0.0
        self._recovery_turn_direction = 0
        self._recovery_reverse_m = 0.0
        self._recovery_turn_rad = 0.0
        self._recovery_reverse_speed_mps = 0.0
        self._recovery_turn_speed_radps = 0.0
        self._recovery_timeout_s = 0.0

    @property
    def active(self) -> bool:
        return self._tracker is not None

    @property
    def recovering(self) -> bool:
        return self._recovery_phase is not None

    def follow(self, waypoints: list[Point], start: Point | None = None) -> None:
        self._recovery_phase = None
        self._tracker = PathTracker(waypoints, self._tolerance, start=start)
        self._stuck.reset()
        self._deviation.reset_confirmation()

    def step(self, pose: Pose, now_s: float,
             command_blocked: Callable[[VelocityCommand], bool] | None = None) -> MotionState:
        if self._recovery_phase is not None:
            return self._step_recovery(pose, now_s, command_blocked)
        if self._tracker is None:
            return MotionState.IDLE
        previous_waypoint_index = self._tracker.waypoint_index
        command = self._tracker.next_command(pose)
        if self._tracker.waypoint_index != previous_waypoint_index:
            self._deviation.reset_confirmation()
        if command is None:
            self.stop()
            return MotionState.ARRIVED
        if command_blocked is not None and command_blocked(command):
            turn = VelocityCommand(0.0, command.angular_radps)
            if (command.linear_mps > 0 and abs(turn.angular_radps) >= ALIGN_TURN_MIN_RADPS
                    and not command_blocked(turn)):
                # ход с подворотом задевает препятствие у пути: сперва довернуть на месте к сегменту
                self._drive.command(turn.linear_mps, turn.angular_radps)
                return MotionState.MOVING
            self._drive.stop()
            return MotionState.BLOCKED
        if self._deviation.is_deviated(self._tracker.cross_track_error_m(pose), now_s):
            self._drive.stop()
            return MotionState.OFF_PATH
        path_progress = self._tracker.progress_m(pose)
        translating = command.linear_mps > 0.0
        if self._stuck.is_stuck(path_progress, now_s, translating=translating):
            self.stop()
            return MotionState.STUCK
        self._drive.command(command.linear_mps, command.angular_radps)
        return MotionState.MOVING

    def begin_recovery(self, pose: Pose, now_s: float, *, reverse_m: float, turn_rad: float,
                       reverse_speed_mps: float, turn_speed_radps: float, timeout_s: float) -> None:
        """Begin one bounded reverse-then-turn maneuver; every command is checked in step()."""
        self._tracker = None
        self._stuck.reset()
        self._deviation.reset_confirmation()
        self._recovery_phase = "reverse"
        self._recovery_started_s = now_s
        self._recovery_start_pose = pose
        self._recovery_phase_heading_rad = pose.heading_rad
        self._recovery_turn_direction = 0
        self._recovery_reverse_m = max(0.0, reverse_m)
        self._recovery_turn_rad = max(0.0, turn_rad)
        self._recovery_reverse_speed_mps = max(0.0, reverse_speed_mps)
        self._recovery_turn_speed_radps = max(0.0, turn_speed_radps)
        self._recovery_timeout_s = max(0.0, timeout_s)
        self._drive.stop()

    def _step_recovery(self, pose: Pose, now_s: float,
                       command_blocked: Callable[[VelocityCommand], bool] | None) -> MotionState:
        if now_s - self._recovery_started_s >= self._recovery_timeout_s:
            return self._finish_recovery(MotionState.RECOVERY_FAILED)
        if self._recovery_phase == "reverse":
            start = self._recovery_start_pose
            if start is None:
                return self._finish_recovery(MotionState.RECOVERY_FAILED)
            dx, dy = start.x_m - pose.x_m, start.y_m - pose.y_m
            retreat_progress = dx * math.cos(start.heading_rad) + dy * math.sin(start.heading_rad)
            if retreat_progress >= self._recovery_reverse_m:
                self._recovery_phase = "turn"
                self._recovery_phase_heading_rad = pose.heading_rad
                self._drive.stop()
                return MotionState.RECOVERING
            reverse = VelocityCommand(-self._recovery_reverse_speed_mps, 0.0)
            if command_blocked is not None and command_blocked(reverse):
                return self._finish_recovery(MotionState.RECOVERY_FAILED)
            self._drive.command(reverse.linear_mps, reverse.angular_radps)
            return MotionState.RECOVERING

        if self._recovery_phase == "turn":
            if self._recovery_turn_direction == 0:
                left = VelocityCommand(0.0, self._recovery_turn_speed_radps)
                right = VelocityCommand(0.0, -self._recovery_turn_speed_radps)
                left_blocked = command_blocked is not None and command_blocked(left)
                right_blocked = command_blocked is not None and command_blocked(right)
                if left_blocked and right_blocked:
                    return self._finish_recovery(MotionState.RECOVERY_FAILED)
                self._recovery_turn_direction = -1 if left_blocked else 1
            turned = normalize_angle(pose.heading_rad - self._recovery_phase_heading_rad)
            if turned * self._recovery_turn_direction >= self._recovery_turn_rad:
                return self._finish_recovery(MotionState.RECOVERED)
            command = VelocityCommand(0.0, self._recovery_turn_direction * self._recovery_turn_speed_radps)
            if command_blocked is not None and command_blocked(command):
                return self._finish_recovery(MotionState.RECOVERY_FAILED)
            self._drive.command(command.linear_mps, command.angular_radps)
            return MotionState.RECOVERING
        return self._finish_recovery(MotionState.RECOVERY_FAILED)

    def _finish_recovery(self, result: MotionState) -> MotionState:
        self._recovery_phase = None
        self._recovery_start_pose = None
        self._drive.stop()
        return result

    def hold(self) -> None:
        """Пауза без отмены пути (уступаем партнёру): ожидание не считается застреванием."""
        self._stuck.reset()
        if self._recovery_phase is not None:
            self._recovery_phase = None
        self._drive.stop()

    def stop(self) -> None:
        """Останавливает всегда, даже без активного пути; восстановление связи не возобновляет путь."""
        self._tracker = None
        self._recovery_phase = None
        self._deviation.reset_confirmation()
        self._drive.stop()
