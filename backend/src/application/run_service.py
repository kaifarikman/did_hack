"""Жизненный цикл прогонов: старт/стоп, дедупликация команд, снимки и журнал."""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from typing import Callable

from application.errors import EnvironmentNotReady, InvalidRequest, RunConflict, ScenarioUnavailable, UnknownRun
from application.mission_controller import MissionController
from application.ports import EnvironmentStatus, JournalStore, MapSource
from domain.journal import JournalEntry
from domain.mission import Mission, MissionSnapshot, MissionStatus
from domain.settings import MissionSettings

KNOWN_SCENARIOS = ("easy", "medium", "hard")
JOURNAL_LIMIT_MAX = 200

ControllerFactory = Callable[[Mission], MissionController]


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
    ) -> None:
        self._environment = environment
        self._maps = maps
        self._journal = journal
        self._controller_factory = controller_factory
        self._settings = settings
        self._id_factory = id_factory
        self._lock = threading.Lock()
        self._missions: dict[str, Mission] = {}
        self._controllers: dict[str, MissionController] = {}
        self._current: Mission | None = None
        self._commands: dict[str, tuple[tuple, str]] = {}
        self._generation = 0

    def _next_generation(self) -> int:
        self._generation += 1
        return self._generation

    # ----------------------------------------------------------- queries

    def state(self) -> MissionSnapshot:
        current = self._current
        if current is not None:
            return current.snapshot()
        grid = self._maps.load()
        return MissionSnapshot(
            run_id=None, revision=0, status=MissionStatus.IDLE, scenario=None, seed=None,
            judge_mode=self._settings.judge_mode,
            planner_mode="llm" if self._environment.llm_available() else "fallback",
            simulation_time_s=None, map_id=grid.map_id if grid else None, robot_pose=None,
            base_position=self._settings.base, battery_remaining=None,
            battery_initial=self._settings.battery_initial, sample_signal=None, samples_collected=0,
            return_energy_estimate=None, current_goal=None, trajectory=(), planned_path=(),
            collected_samples=(), terrain_estimates=(), last_error=None,
        )

    def journal_page(self, run_id: str, after_sequence: int, limit: int) -> JournalPage:
        if after_sequence < 0 or not 1 <= limit <= JOURNAL_LIMIT_MAX:
            raise InvalidRequest("after_sequence >= 0, limit от 1 до 200")
        if run_id not in self._missions:
            raise UnknownRun(f"Прогон {run_id} неизвестен.")
        entries, has_more = self._journal.read(run_id, after_sequence, limit)
        return JournalPage(run_id, entries, entries[-1].sequence if entries else after_sequence, has_more)

    # ---------------------------------------------------------- commands

    def start_run(self, request_id: str, scenario: str, seed: int) -> MissionSnapshot:
        fingerprint = ("start", scenario, seed)
        with self._lock:
            replay = self._replay(request_id, fingerprint)
            if replay is not None:
                return replay.snapshot()
            if scenario not in KNOWN_SCENARIOS:
                raise InvalidRequest(f"Сценарий {scenario!r} неизвестен.")
            if scenario not in self._environment.supported_scenarios():
                raise ScenarioUnavailable(f"Среда пока не поддерживает сценарий {scenario!r}.")
            current = self._current
            if current is not None and current.status.is_active:
                raise RunConflict("Другой прогон ещё активен.")
            if not self._environment.ros_connected() or self._maps.load() is None:
                raise EnvironmentNotReady("Ожидаются наблюдения ROS и карта.")
            mission = Mission(
                run_id=self._id_factory(), scenario=scenario, seed=seed,
                judge_mode=self._settings.judge_mode,
                planner_mode="llm" if self._environment.llm_available() else "fallback",
                map_id=self._maps.load().map_id, base=self._settings.base,
                battery_initial=self._settings.battery_initial,
                generation=self._next_generation(),
            )
            # новая память исследователя на каждый прогон: фабрика создаёт свежие объекты
            self._controllers[mission.run_id] = self._controller_factory(mission)
            self._missions[mission.run_id] = mission
            self._current = mission
            self._commands[request_id] = (fingerprint, mission.run_id)
            return mission.snapshot()

    def stop_run(self, request_id: str, run_id: str) -> MissionSnapshot:
        fingerprint = ("stop", run_id)
        with self._lock:
            replay = self._replay(request_id, fingerprint)
            if replay is not None:
                return replay.snapshot()
            mission = self._missions.get(run_id)
            if mission is None:
                raise UnknownRun(f"Прогон {run_id} неизвестен.")
            if mission is not self._current:
                raise RunConflict(f"Прогон {run_id} не является текущим.")
            mission.request_stop()
            self._commands[request_id] = (fingerprint, run_id)
            return mission.snapshot()

    def _replay(self, request_id: str, fingerprint: tuple) -> Mission | None:
        known = self._commands.get(request_id)
        if known is None:
            return None
        if known[0] != fingerprint:
            raise RunConflict("request_id уже использован с другим телом запроса.")
        return self._missions[known[1]]

    # -------------------------------------------------------------- tick

    def tick(self) -> None:
        """Один шаг контроллера текущего прогона; вызывается циклом исполнения."""
        current = self._current
        if current is None or current.status.is_terminal:
            return
        controller = self._controllers[current.run_id]
        try:
            controller.tick()
        except Exception as error:  # неожиданный сбой: робот должен остановиться, прогон — failed
            controller.abort(f"Внутренняя ошибка: {type(error).__name__}")
            raise
