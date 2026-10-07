"""Координация команды роботов: брони целей, обмен наблюдениями, разъезд, потеря партнёра.

Каждый робот сам проверяет безопасность и запас возврата; координация только распределяет
цели и делится разрешёнными наблюдениями. Скрытых координат образцов здесь нет: партнёр
передаёт свои измерения сигнала и подтверждённые судьёй сборы.
"""
from __future__ import annotations

from dataclasses import dataclass

from domain.geometry import Point, distance_m


@dataclass(frozen=True)
class Reservation:
    robot_id: str
    target: Point
    expires_at_s: float


class ReservationBook:
    """Бронь цели ограничена по времени: потерянный робот не держит область вечно."""

    def __init__(self, radius_m: float = 0.8, ttl_s: float = 60.0) -> None:
        self.radius_m = radius_m
        self.ttl_s = ttl_s
        self._by_robot: dict[str, Reservation] = {}

    @property
    def reservations(self) -> tuple[Reservation, ...]:
        return tuple(self._by_robot.values())

    def expire(self, now_s: float) -> list[Reservation]:
        expired = [item for item in self._by_robot.values() if item.expires_at_s <= now_s]
        for item in expired:
            del self._by_robot[item.robot_id]
        return expired

    def holder_near(self, point: Point, robot_id: str, now_s: float) -> Reservation | None:
        self.expire(now_s)
        return next(
            (item for item in self._by_robot.values()
             if item.robot_id != robot_id and distance_m(item.target, point) < self.radius_m),
            None,
        )

    def claim(self, robot_id: str, target: Point, now_s: float) -> bool:
        if self.holder_near(target, robot_id, now_s) is not None:
            return False
        self._by_robot[robot_id] = Reservation(robot_id, target, now_s + self.ttl_s)
        return True

    def release(self, robot_id: str) -> Reservation | None:
        return self._by_robot.pop(robot_id, None)


@dataclass(frozen=True)
class SharedSignal:
    """Измерение сигнала с происхождением: (robot_id, sequence) уникально, повтор не учитывается."""

    robot_id: str
    sequence: int
    point: Point
    signal: float
    time_s: float | None


class KnowledgeExchange:
    def __init__(self) -> None:
        self._signals: list[SharedSignal] = []
        self._seen: set[tuple[str, int]] = set()
        self._collected: list[tuple[str, Point, float | None]] = []
        self.duplicates_ignored = 0

    def publish_signal(self, item: SharedSignal) -> bool:
        key = (item.robot_id, item.sequence)
        if key in self._seen:
            self.duplicates_ignored += 1
            return False
        self._seen.add(key)
        self._signals.append(item)
        return True

    def signals_after(self, cursor: int, exclude_robot: str) -> tuple[list[SharedSignal], int]:
        """Чужие измерения с позиции `cursor` и новая позиция курсора."""
        fresh = [item for item in self._signals[cursor:] if item.robot_id != exclude_robot]
        return fresh, len(self._signals)

    def publish_collect(self, robot_id: str, point: Point, time_s: float | None) -> None:
        self._collected.append((robot_id, point, time_s))

    def collects_after(self, cursor: int, exclude_robot: str) -> tuple[list[Point], int]:
        fresh = [point for robot, point, _ in self._collected[cursor:] if robot != exclude_robot]
        return fresh, len(self._collected)


@dataclass(frozen=True)
class PartnerPose:
    robot_id: str
    point: Point
    heading_rad: float
    received_s: float


def must_yield(
    me: str, my_point: Point, partner: PartnerPose | None, now_s: float, priority: tuple[str, ...],
    safe_distance_m: float = 0.6, stale_after_s: float = 2.0,
) -> bool:
    """Ближе безопасного расстояния уступает робот с меньшим приоритетом.

    Устаревшая поза партнёра не используется для разъезда как свежая: безопаснее остановиться
    тому, кто уступает, — поэтому устаревший партнёр рядом тоже заставляет уступить.
    """
    if partner is None or partner.robot_id == me:
        return False
    if distance_m(my_point, partner.point) >= safe_distance_m:
        return False
    if now_s - partner.received_s > stale_after_s:
        return True
    return priority.index(me) > priority.index(partner.robot_id)
