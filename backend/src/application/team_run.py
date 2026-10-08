"""Прогон из одного или нескольких роботов: общий run_id и поколение, отдельные миссии и исходы.

Одиночный прогон — частный случай без координатора. Статус прогона для HTTP выводится из
статусов роботов: прогон активен, пока активен хоть один робот; `completed` — только если все
вернулись и команда собрала хотя бы один образец. Частичный результат виден в `team.outcome`.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

from application.mission_controller import MissionController
from application.team import TeamCoordinator
from domain.mission import Mission, MissionSnapshot, MissionStatus, RobotView, TeamView


@dataclass
class Run:
    missions: list[Mission]
    controllers: list[MissionController]
    coordinator: TeamCoordinator | None = None

    @property
    def lead(self) -> Mission:
        return self.missions[0]

    @property
    def is_active(self) -> bool:
        return any(mission.status.is_active for mission in self.missions)

    @property
    def is_terminal(self) -> bool:
        return all(mission.status.is_terminal for mission in self.missions)

    def request_stop(self) -> None:
        for mission in self.missions:
            mission.request_stop()

    def tick(self) -> None:
        for controller, mission in zip(self.controllers, self.missions):
            if mission.status.is_terminal:
                continue
            try:
                controller.tick()
            except Exception as error:  # сбой одного робота не оставляет его в движении
                controller.abort(f"Внутренняя ошибка: {type(error).__name__}")
                raise

    def snapshot(self) -> MissionSnapshot:
        lead = self.lead.snapshot()
        if len(self.missions) == 1:
            return lead
        snapshots = [mission.snapshot() for mission in self.missions]
        reservations = {item.robot_id: item.target for item in self.coordinator.reservations.reservations}
        robots = tuple(
            RobotView(
                mission.robot_id, snap.status, snap.robot_pose, snap.battery_remaining, snap.samples_collected,
                snap.current_goal, snap.trajectory, snap.planned_path, reservations.get(mission.robot_id),
                snap.last_error, snap.freshness,
            )
            for mission, snap in zip(self.missions, snapshots)
        )
        total = sum(snap.samples_collected for snap in snapshots)
        statuses = [snap.status for snap in snapshots]
        team = TeamView(robots, _outcome(statuses, total), total, not self.coordinator.independent,
                        tuple(sorted(self.coordinator.lost)))
        return replace(lead, status=_team_status(statuses, total), samples_collected=total, team=team,
                       revision=sum(snap.revision for snap in snapshots),
                       route_revision=sum(snap.route_revision for snap in snapshots),
                       plan_revision=sum(snap.plan_revision for snap in snapshots),
                       map_revision=max((snap.map_revision for snap in snapshots), default=0),
                       model_revision=sum(snap.model_revision for snap in snapshots))


def _outcome(statuses: list[MissionStatus], total: int) -> str:
    if any(not status.is_terminal for status in statuses):
        return "running"
    if all(status is MissionStatus.COMPLETED for status in statuses):
        return "success" if total > 0 else "failed"
    if any(status is MissionStatus.STOPPED for status in statuses):
        return "stopped"
    return "partial" if total > 0 and any(status is MissionStatus.COMPLETED for status in statuses) else "failed"


def _team_status(statuses: list[MissionStatus], total: int) -> MissionStatus:
    active = [status for status in statuses if not status.is_terminal]
    if active:
        for status in (MissionStatus.STOPPING, MissionStatus.STARTING, MissionStatus.RUNNING):
            if status in active:
                return status
        return MissionStatus.RETURNING
    outcome = _outcome(statuses, total)
    if outcome == "success":
        return MissionStatus.COMPLETED
    return MissionStatus.STOPPED if outcome == "stopped" else MissionStatus.FAILED
