"""Командный судья: общие образцы, раздельные батареи и завершение. Без ROS и сети.

Правила (локальные допущения проекта, не требования организаторов):
- образец принадлежит команде и засчитывается один раз тому роботу, чей сбор обработан первым;
- батарея, коллизии, finish и отказ каждого робота учитываются отдельно и не маскируются общим итогом;
- у каждого робота своя точка старта/финиша; командный итог перечисляет оба результата.
"""
import threading
from dataclasses import replace
from typing import Dict, List, Optional, Tuple

from .config import JudgeConfig
from .dynamics import EventSchedule
from .engine import ActionResult, JudgeEngine
from .scenario import Scenario

Point = Tuple[float, float]


def default_robot_bases(robot_ids, first_base: Point, spacing_m: float = 1.0) -> Dict[str, Point]:
    """Площадки в ряд вдоль Y; должны совпадать со спавном в multi_robot_world.launch.py."""
    return {robot_id: (first_base[0], first_base[1] + index * spacing_m) for index, robot_id in enumerate(robot_ids)}


class TeamJudge:
    def __init__(self, scenario: Scenario, config: JudgeConfig, robot_bases: Dict[str, Point],
                 schedule: Optional[EventSchedule] = None) -> None:
        if not robot_bases:
            raise ValueError("Нужен хотя бы один робот")
        self._lock = threading.Lock()
        self._shared_remaining: List[Point] = list(scenario.samples)
        self.engines: Dict[str, JudgeEngine] = {
            robot_id: JudgeEngine(scenario, replace(config, base_world_m=base), schedule=schedule,
                                  shared_remaining=self._shared_remaining)
            for robot_id, base in robot_bases.items()}

    def _engine(self, robot_id: str) -> JudgeEngine:
        try:
            return self.engines[robot_id]
        except KeyError:
            raise KeyError(f"Неизвестный робот: {robot_id}") from None

    def update_pose(self, robot_id: str, x_m: float, y_m: float, heading_rad: float, time_s: float) -> None:
        with self._lock:
            self._engine(robot_id).update_pose(x_m, y_m, heading_rad, time_s)

    def register_collision(self, robot_id: str) -> None:
        with self._lock:
            self._engine(robot_id).register_collision()

    def sample_signal(self, robot_id: str) -> Optional[float]:
        with self._lock:
            return self._engine(robot_id).sample_signal()

    def collect(self, robot_id: str) -> ActionResult:
        with self._lock:
            return self._engine(robot_id).collect()

    def finish(self, robot_id: str) -> ActionResult:
        with self._lock:
            return self._engine(robot_id).finish()

    def soil_zones(self):
        return next(iter(self.engines.values())).soil_zones()

    @property
    def samples_remaining(self) -> int:
        return len(self._shared_remaining)

    def robot_summary(self, robot_id: str) -> dict:
        engine = self._engine(robot_id)
        return {"state": engine.state_label(), "score": engine.score(), "collected": engine.collected,
                "collisions": engine.collisions, "false_collects": engine.false_collects,
                "finished": engine.finished, "finish_success": engine.finish_success,
                "battery": engine.battery}

    def team_summary(self) -> dict:
        """Общий счёт плюс результаты каждого робота: успех команды не скрывает отказ участника."""
        robots = {robot_id: self.robot_summary(robot_id) for robot_id in self.engines}
        return {
            "robots": robots,
            "team_collected": sum(robot["collected"] for robot in robots.values()),
            "team_score": sum(robot["score"] for robot in robots.values()),
            "all_finished_successfully": all(robot["finish_success"] for robot in robots.values()),
            "failed_robots": sorted(robot_id for robot_id, robot in robots.items()
                                    if robot["state"] == "depleted" or (robot["finished"] and not robot["finish_success"])),
        }
