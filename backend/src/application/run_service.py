"""Жизненный цикл прогонов: старт/стоп, дедупликация команд, снимки и журнал."""
from __future__ import annotations

import math
import threading
import uuid
from dataclasses import dataclass
from typing import Callable

from application.errors import (
    EnvironmentNotReady, InvalidRequest, MapChanged, NavigationTargetUnreachable, RunConflict, ScenarioUnavailable,
    UnknownRun,
)
from application.mission_controller import MissionController
from application.navigation_goal import assess_navigation_target
from application.navigation_service import NavigationService
from application.ports import EnvironmentStatus, JournalStore, MapSource
from application.team import RobotLink, TeamCoordinator
from application.team_run import Run
from domain.energy import TerrainEstimator
from domain.journal import JournalEntry
from domain.mission import Mission, MissionSnapshot, MissionStatus
from domain.navigation_task import NavigationTarget, NavigationTask, TaskType
from domain.observations import DEFAULT_ROBOT_ID, ObservationFreshness
from domain.profiles import PUBLIC_PROFILES, settings_for_profile
from domain.settings import MissionSettings

KNOWN_SCENARIOS = ("easy", "medium", "hard")
DEFAULT_MISSION_TEXT = "Собрать как можно больше образцов и вернуться на базу с положительной батареей."
DEFAULT_NAVIGATION_TEXT = "Дойти до заданной точки и вернуться на базу с положительной батареей."
SUPPORTED_TASK_TYPES = (TaskType.RESEARCH.value, TaskType.NAVIGATION.value)
NAVIGATION_PROFILE = ("easy", "static", 1)  # единственный профиль навигации потока защиты
MISSION_TEXT_MAX = 500
JOURNAL_LIMIT_MAX = 200

ControllerFactory = Callable[[Mission, "RobotLink | None"], MissionController]
TEAM_ROBOT_IDS = ("robot_1", "robot_2")


@dataclass(frozen=True)
class JournalPage:
    run_id: str
    entries: list[JournalEntry]
    next_sequence: int
    has_more: bool


class RunService:
    def __init__(
        self,
        environment: EnvironmentStatus,
        maps: MapSource,
        journal: JournalStore,
        controller_factory: ControllerFactory,
        settings: MissionSettings,
        id_factory: Callable[[], str] = lambda: uuid.uuid4().hex,
        initial_generation: int = 0,
    ) -> None:
        if type(initial_generation) is not int or initial_generation < 0:
            raise ValueError("initial_generation должен быть неотрицательным целым")
        self._environment = environment
        self._maps = maps
        self._journal = journal
        self._controller_factory = controller_factory
        self._settings = settings
        self._id_factory = id_factory
        self._lock = threading.Lock()
        self._runs: dict[str, Run] = {}
        self._current: Run | None = None
        self._commands: dict[str, tuple[tuple, str]] = {}
        self._generation = initial_generation

    def _next_generation(self) -> int:
        self._generation += 1
        return self._generation

    # ----------------------------------------------------------- queries

    @staticmethod
    def supported_task_types() -> tuple[str, ...]:
        return SUPPORTED_TASK_TYPES

    def state(self) -> MissionSnapshot:
        current = self._current
        if current is not None:
            return current.snapshot()
        grid = self._maps.load()
        return MissionSnapshot(
            run_id=None, generation=None, observation_sequence=None, sample_signal_age_s=None,
            robot_id=DEFAULT_ROBOT_ID, freshness=ObservationFreshness(),
            revision=0, status=MissionStatus.IDLE, scenario=None, seed=None,
            route_revision=0, plan_revision=0, map_revision=grid.revision if grid else 0, model_revision=0,
            judge_mode=self._settings.judge_mode,
            planner_mode="llm" if self._environment.llm_available() else "fallback",
            simulation_time_s=None, map_id=grid.versioned_id if grid else None, robot_pose=None,
            base_position=self._settings.base, battery_remaining=None,
            battery_initial=self._settings.battery_initial, sample_signal=None, samples_collected=0,
            return_energy_estimate=None, current_goal=None, trajectory=(), planned_path=(),
            collected_samples=(), terrain_estimates=(), last_error=None,
        )

    def journal_page(self, run_id: str, after_sequence: int, limit: int) -> JournalPage:
        if after_sequence < 0 or not 1 <= limit <= JOURNAL_LIMIT_MAX:
            raise InvalidRequest("after_sequence >= 0, limit от 1 до 200")
        if run_id not in self._runs:
            raise UnknownRun(f"Прогон {run_id} неизвестен.")
        entries, has_more = self._journal.read(run_id, after_sequence, limit)
        return JournalPage(run_id, entries, entries[-1].sequence if entries else after_sequence, has_more)

    # ---------------------------------------------------------- commands

    def start_run(self, request_id: str, scenario: str, seed: int, mission_text: str | None = None,
                  map_mode: str = "static", robot_count: int = 1, coordinated: bool = True,
                  task_type: str = TaskType.RESEARCH.value,
                  navigation_target: NavigationTarget | None = None) -> MissionSnapshot:
        task = _parse_task(task_type, navigation_target)
        default_text = DEFAULT_NAVIGATION_TEXT if task is TaskType.NAVIGATION else DEFAULT_MISSION_TEXT
        text = (mission_text or "").strip() or default_text
        if len(text) > MISSION_TEXT_MAX:
            raise InvalidRequest(f"Текст миссии длиннее {MISSION_TEXT_MAX} символов.")
        target_key = None if navigation_target is None else (
            navigation_target.point.x_m, navigation_target.point.y_m, navigation_target.map_id)
        fingerprint = ("start", scenario, seed, text, map_mode, robot_count, coordinated, task.value, target_key)
        with self._lock:
            replay = self._replay(request_id, fingerprint)
            if replay is not None:
                return replay.snapshot()
            if scenario not in KNOWN_SCENARIOS:
                raise InvalidRequest(f"Сценарий {scenario!r} неизвестен.")
            if scenario not in self._environment.supported_scenarios():
                raise ScenarioUnavailable(f"Среда пока не поддерживает сценарий {scenario!r}.")
            current = self._current
            if current is not None and current.is_active:
                raise RunConflict("Другой прогон ещё активен.")
            if robot_count not in (1, 2):
                raise InvalidRequest("robot_count: 1 или 2.")
            if robot_count not in self._environment.supported_robot_counts():
                raise ScenarioUnavailable(f"Среда пока не поддерживает {robot_count} роботов.")
            if map_mode not in ("static", "slam"):
                raise InvalidRequest(f"Режим карты {map_mode!r} неизвестен.")
            if map_mode not in self._environment.supported_map_modes():
                raise ScenarioUnavailable(f"Среда пока не поддерживает режим карты {map_mode!r}.")
            # в SLAM карты в начале может не быть: робот ждёт её сам, а не отказывает старту
            if task is TaskType.NAVIGATION and (scenario, map_mode, robot_count) != NAVIGATION_PROFILE:
                raise ScenarioUnavailable("Навигация к точке поддерживается только в профиле easy/static/1 робот.")
            if not self._environment.ros_connected() or (map_mode == "static" and self._maps.load() is None):
                raise EnvironmentNotReady("Ожидаются наблюдения ROS и карта.")
            navigation_task = None
            if navigation_target is not None:
                navigation_task = self._check_navigation_target(scenario, navigation_target)
            run_id, generation = self._id_factory(), self._next_generation()
            robot_ids = TEAM_ROBOT_IDS[:robot_count]
            missions = [
                Mission(
                    run_id=run_id, scenario=scenario, seed=seed,
                    judge_mode=self._settings.judge_mode,
                    # навигация детерминирована и не обращается к LLM
                    planner_mode="llm" if self._environment.llm_available() and navigation_task is None
                    else "fallback",
                    map_id=self._map_id(), base=self._settings.base,
                    battery_initial=self._settings.battery_initial,
                    generation=generation, mission_text=text,
                    target_samples=PUBLIC_PROFILES[scenario].sample_count,
                    map_mode=map_mode, robot_id=robot_id, navigation=navigation_task,
                )
                for robot_id in robot_ids
            ]
            coordinator = TeamCoordinator(robot_ids, independent=not coordinated) if robot_count > 1 else None
            # новая память исследователя на каждый прогон: фабрика создаёт свежие объекты
            controllers = [
                self._controller_factory(mission, coordinator.link(mission.robot_id) if coordinator else None)
                for mission in missions
            ]
            run = Run(missions, controllers, coordinator)
            self._runs[run_id] = run
            self._current = run
            self._commands[request_id] = (fingerprint, run_id)
            return run.snapshot()

    def stop_run(self, request_id: str, run_id: str) -> MissionSnapshot:
        fingerprint = ("stop", run_id)
        with self._lock:
            replay = self._replay(request_id, fingerprint)
            if replay is not None:
                return replay.snapshot()
            run = self._runs.get(run_id)
            if run is None:
                raise UnknownRun(f"Прогон {run_id} неизвестен.")
            if run is not self._current:
                raise RunConflict(f"Прогон {run_id} не является текущим.")
            run.request_stop()
            self._commands[request_id] = (fingerprint, run_id)
            return run.snapshot()

    def _check_navigation_target(self, scenario: str, target: NavigationTarget) -> NavigationTask:
        """До сброса: версия карты, геометрия, путь туда и домой и энергия от базы с полной батареей."""
        grid = self._maps.load()
        if grid is None or grid.versioned_id != target.map_id:
            raise MapChanged("Карта изменилась после выбора цели: загрузите карту и подтвердите точку заново.")
        settings = settings_for_profile(scenario, self._settings)
        navigation = NavigationService(grid, TerrainEstimator(), settings)
        assessment = assess_navigation_target(
            navigation, settings, settings.base, target.point, settings.battery_initial)
        if not assessment.accepted:
            raise NavigationTargetUnreachable(assessment.message)
        return NavigationTask(target, settings.arrival_tolerance_m)

    def _map_id(self) -> str | None:
        grid = self._maps.load()
        return grid.versioned_id if grid else None

    def _replay(self, request_id: str, fingerprint: tuple) -> Run | None:
        known = self._commands.get(request_id)
        if known is None:
            return None
        if known[0] != fingerprint:
            raise RunConflict("request_id уже использован с другим телом запроса.")
        return self._runs[known[1]]

    # -------------------------------------------------------------- tick

    def tick(self) -> None:
        """Один шаг контроллера текущего прогона; вызывается циклом исполнения."""
        current = self._current
        if current is None or current.is_terminal:
            return
        current.tick()  # неожиданный сбой робота: он остановлен и failed, исключение уходит в цикл


def _parse_task(task_type: str, target: NavigationTarget | None) -> TaskType:
    """Сочетание полей: навигации нужна конечная цель, исследованию цель запрещена."""
    try:
        task = TaskType(task_type)
    except ValueError:
        raise InvalidRequest(f"Тип задачи {task_type!r} неизвестен.") from None
    if task is TaskType.NAVIGATION and target is None:
        raise InvalidRequest("Для navigation нужна navigation_target.")
    if task is TaskType.RESEARCH and target is not None:
        raise InvalidRequest("Для research navigation_target должна быть null.")
    if target is not None:
        if not all(math.isfinite(value) for value in (target.point.x_m, target.point.y_m)):
            raise InvalidRequest("Координаты цели должны быть конечными числами.")
        if not target.map_id:
            raise InvalidRequest("map_id цели не может быть пустым.")
    return task
