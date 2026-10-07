"""Координатор команды: общий для всех роботов прогона, по одной `RobotLink` на робота.

Владеет бронями, обменом наблюдениями и последними позами партнёров. Контроллер каждого робота
остаётся владельцем своей миссии, энергии и исполнения; связь только сообщает и запрещает.
"""
from __future__ import annotations

from dataclasses import dataclass

from domain.coordination import KnowledgeExchange, PartnerPose, ReservationBook, SharedSignal, must_yield
from domain.geometry import Point, Pose, distance_m


@dataclass(frozen=True)
class TeamSettings:
    reservation_radius_m: float = 0.8
    reservation_ttl_s: float = 60.0
    lost_after_s: float = 5.0  # нет наблюдений партнёра дольше — он потерян, его брони снимаются
    safe_distance_m: float = 0.6
    share_spacing_m: float = 0.15


class TeamCoordinator:
    def __init__(self, robot_ids: tuple[str, ...], settings: TeamSettings | None = None,
                 independent: bool = False) -> None:
        self.robot_ids = robot_ids
        self.settings = settings or TeamSettings()
        self.independent = independent  # базовая линия: роботы не координируются
        self.reservations = ReservationBook(self.settings.reservation_radius_m, self.settings.reservation_ttl_s)
        self.exchange = KnowledgeExchange()
        self.poses: dict[str, PartnerPose] = {}
        self.lost: set[str] = set()
        self.finished: set[str] = set()

    def link(self, robot_id: str) -> "RobotLink":
        return RobotLink(self, robot_id)

    def detect_lost(self, now_s: float) -> list[str]:
        newly = [
            robot_id for robot_id, pose in self.poses.items()
            if robot_id not in self.lost and robot_id not in self.finished
            and now_s - pose.received_s > self.settings.lost_after_s
        ]
        for robot_id in newly:
            self.lost.add(robot_id)
            self.reservations.release(robot_id)
        return newly


class RobotLink:
    """Порт координации одного робота."""

    def __init__(self, team: TeamCoordinator, robot_id: str) -> None:
        self._team = team
        self.robot_id = robot_id
        self._signal_cursor = 0
        self._collect_cursor = 0
        self._sequence = 0
        self._last_shared: Point | None = None
        self._reported_lost: set[str] = set()

    @property
    def team_ids(self) -> tuple[str, ...]:
        return self._team.robot_ids

    def report_pose(self, pose: Pose, now_s: float) -> None:
        self._team.poses[self.robot_id] = PartnerPose(self.robot_id, pose.point, pose.heading_rad, now_s)

    def mark_lost(self) -> None:
        """Робот потерял наблюдения или позу: его задачи освобождаются, партнёр узнает о потере."""
        self._team.lost.add(self.robot_id)
        self._team.reservations.release(self.robot_id)

    def finish(self) -> None:
        """Робот завершил свою миссию: его брони снимаются, он не считается потерянным."""
        self._team.finished.add(self.robot_id)
        self._team.reservations.release(self.robot_id)

    # --------------------------------------------------------------- брони

    def conflict(self, target: Point, now_s: float) -> str | None:
        if self._team.independent:
            return None
        holder = self._team.reservations.holder_near(target, self.robot_id, now_s)
        return None if holder is None else holder.robot_id

    def claim(self, target: Point, now_s: float) -> bool:
        return self._team.independent or self._team.reservations.claim(self.robot_id, target, now_s)

    def release(self) -> None:
        self._team.reservations.release(self.robot_id)

    # --------------------------------------------------------------- знания

    def share_signal(self, point: Point, signal: float, time_s: float | None) -> None:
        if self._team.independent:
            return
        if self._last_shared is not None and distance_m(self._last_shared, point) < self._team.settings.share_spacing_m:
            return
        self._sequence += 1
        self._last_shared = point
        self._team.exchange.publish_signal(SharedSignal(self.robot_id, self._sequence, point, signal, time_s))

    def partner_signals(self) -> list[SharedSignal]:
        fresh, self._signal_cursor = self._team.exchange.signals_after(self._signal_cursor, self.robot_id)
        return [] if self._team.independent else fresh

    def share_collect(self, point: Point, time_s: float | None) -> None:
        self._team.exchange.publish_collect(self.robot_id, point, time_s)

    def partner_collects(self) -> list[Point]:
        fresh, self._collect_cursor = self._team.exchange.collects_after(self._collect_cursor, self.robot_id)
        return [] if self._team.independent else fresh

    # --------------------------------------------------------------- движение

    def must_yield(self, point: Point, now_s: float) -> str | None:
        """Идентификатор партнёра, которому нужно уступить, или None."""
        for robot_id, pose in self._team.poses.items():
            if robot_id == self.robot_id or robot_id in self._team.lost or robot_id in self._team.finished:
                continue
            if must_yield(self.robot_id, point, pose, now_s, self._team.robot_ids, self._team.settings.safe_distance_m):
                return robot_id
        return None

    def newly_lost(self, now_s: float) -> list[str]:
        self._team.detect_lost(now_s)
        fresh = [robot_id for robot_id in self._team.lost if robot_id not in self._reported_lost and robot_id != self.robot_id]
        self._reported_lost.update(fresh)
        return fresh
