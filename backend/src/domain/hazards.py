"""Наблюдаемые опасные области: только по разрешённым событиям hazard_hit и позе робота.

Истинная граница зоны неизвестна: область — круг вокруг поз робота в моменты событий с
неопределённостью позиции. Повторное попадание рядом расширяет и подтверждает область.
"""
from __future__ import annotations

from dataclasses import dataclass

from domain.geometry import Point, distance_m


@dataclass(frozen=True)
class HazardSighting:
    detection_id: str
    center: Point
    radius_m: float
    hits: int
    last_time_s: float | None


class HazardMap:
    def __init__(self, base_radius_m: float = 0.35, merge_distance_m: float = 0.6, avoid_multiplier: float = 8.0,
                 expected_penalty: float = 1.0) -> None:
        self._base_radius = base_radius_m
        self._merge_distance = merge_distance_m
        self._avoid_multiplier = avoid_multiplier
        self.expected_penalty = expected_penalty
        self._sightings: list[HazardSighting] = []

    @property
    def sightings(self) -> tuple[HazardSighting, ...]:
        return tuple(self._sightings)

    def record_hit(self, position: Point, time_s: float | None, position_uncertainty_m: float = 0.0
                   ) -> tuple[HazardSighting, bool]:
        """Возвращает область и признак новой области (False — подтверждение существующей)."""
        for index, sighting in enumerate(self._sightings):
            if distance_m(sighting.center, position) <= self._merge_distance:
                center = Point((sighting.center.x_m * sighting.hits + position.x_m) / (sighting.hits + 1),
                               (sighting.center.y_m * sighting.hits + position.y_m) / (sighting.hits + 1))
                radius = max(sighting.radius_m, distance_m(center, position) + self._base_radius)
                updated = HazardSighting(sighting.detection_id, center, radius, sighting.hits + 1, time_s)
                self._sightings[index] = updated
                return updated, False
        sighting = HazardSighting(f"hazard-{len(self._sightings) + 1}", position,
                                  self._base_radius + position_uncertainty_m, 1, time_s)
        self._sightings.append(sighting)
        return sighting, True

    def containing(self, point: Point) -> HazardSighting | None:
        return next((s for s in self._sightings if distance_m(s.center, point) <= s.radius_m), None)

    def cost_multiplier(self, point: Point) -> float:
        return self._avoid_multiplier if self.containing(point) is not None else 1.0

    def crossings(self, start: Point, waypoints: tuple[Point, ...] | list[Point], step_m: float = 0.1) -> int:
        """Сколько разных опасных областей пересекает ломаная."""
        crossed: set[str] = set()
        previous = start
        for waypoint in waypoints:
            length = distance_m(previous, waypoint)
            pieces = max(1, int(length / step_m))
            for piece in range(pieces + 1):
                fraction = piece / pieces
                probe = Point(previous.x_m + (waypoint.x_m - previous.x_m) * fraction,
                              previous.y_m + (waypoint.y_m - previous.y_m) * fraction)
                sighting = self.containing(probe)
                if sighting is not None:
                    crossed.add(sighting.detection_id)
            previous = waypoint
        return len(crossed)
