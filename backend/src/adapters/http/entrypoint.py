"""Точка запуска: связывает ROS, LLM, журнал и HTTP. Единственное место, где зависимости собираются вместе."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI

from adapters.http.app import create_app
from adapters.journal.jsonl import JsonlJournal
from adapters.legacy_reset import LEGACY_SCENARIOS
from adapters.llm.config import LlmConfig
from adapters.llm.openai_planner import OpenAiCompatiblePlanner
from adapters.map_file import load_nav2_map
from adapters.ros.bridge import RosRuntime
from adapters.ros.simulation_control import SupervisorSimulationControl
from application.mission_controller import ControllerPorts, MissionController
from application.motion import MotionExecutor
from application.navigation_service import NavigationService
from application.research import TerrainResearch
from application.planner import FallbackPlanner, ResilientPlanner
from application.ports import MapMode
from application.run_service import RunService
from application.ticker import TickLoop
from domain.energy import TerrainEstimator
from domain.hazards import HazardMap
from domain.hypotheses import HypothesisBook
from domain.mission import Mission
from domain.navigation import StuckDetector
from domain.profiles import settings_for_profile
from domain.search import SignalSearch
from domain.settings import MissionSettings

import time


class _MonotonicClock:
    def monotonic_s(self) -> float:
        return time.monotonic()


@dataclass
class _Environment:
    runtime: RosRuntime
    llm_configured: bool
    judge_mode: str = "local"
    scenarios: tuple[str, ...] = LEGACY_SCENARIOS
    map_modes: tuple[str, ...] = ("static",)
    robot_counts: tuple[int, ...] = (1,)

    def ros_connected(self) -> bool:
        return self.runtime.bridge.ros_connected()

    def llm_available(self) -> bool:
        return self.llm_configured

    def supported_scenarios(self) -> tuple[str, ...]:
        return self.scenarios

    def supported_map_modes(self) -> tuple[str, ...]:
        return self.map_modes

    def supported_robot_counts(self) -> tuple[int, ...]:
        return self.robot_counts


class _LazyMap:
    def __init__(self, yaml_path: Path) -> None:
        self._yaml_path = yaml_path
        self._grid = None

    def load(self):
        if self._grid is None and self._yaml_path.exists():
            self._grid = load_nav2_map(self._yaml_path)
        return self._grid


def create_default_app() -> FastAPI:
    settings = MissionSettings(
        stuck_window_s=float(os.environ.get("STUCK_WINDOW_S", "6.0")),
        stuck_min_progress_m=float(os.environ.get("STUCK_MIN_PROGRESS_M", "0.05")),
    )
    maps = _LazyMap(Path(os.environ.get("MAP_YAML", "/workspace/simulation/judge/data/map.yaml")))
    journal = JsonlJournal(Path(os.environ.get("JOURNAL_DIR", "/data/journal")))
    llm_config = LlmConfig.from_environment()
    if llm_config is not None:
        llm_config.validate_execution_deadline(settings.planner_timeout_s)
    runtime = RosRuntime(
        observation_max_age_s=settings.observation_max_age_s,
        odom_topic=os.environ.get("ROS_ODOM_TOPIC", "/odom"),
        scan_topic=os.environ.get("ROS_SCAN_TOPIC", "/scan"),
    )
    bridge = runtime.bridge
    supervisor = SupervisorSimulationControl(
        os.environ.get("SIMULATION_URL", "http://simulation:7000"), bridge.clear_observations,
        set_generation=bridge.set_generation)
    # Supervisor API передаёт generation судье; другие режимы откроются после их сквозной приёмки.
    simulation, scenarios = supervisor, LEGACY_SCENARIOS
    map_modes, robot_counts = ("static",), (1,)
    environment = _Environment(runtime, llm_config is not None, settings.judge_mode, scenarios, map_modes,
                               robot_counts)
    # События и счёт подключаются, когда мост A их реализует (контракт 2.0); иначе ядро работает как в MVP.
    events = bridge if hasattr(bridge, "events_after") else None
    score = bridge if hasattr(bridge, "score") else None
    clock = _MonotonicClock()

    def build_controller(mission: Mission, link=None) -> MissionController:
        # мост A пока один и адресует robot_1; второй робот подключается, когда A даст порты по robot_id
        run_settings = settings_for_profile(mission.scenario, settings)
        estimator, hazards = TerrainEstimator(), HazardMap()
        grid = maps.load()
        planner = ResilientPlanner(
            OpenAiCompatiblePlanner(llm_config) if llm_config else None, FallbackPlanner(run_settings))
        ports = ControllerPorts(
            observations=bridge,
            motion=MotionExecutor(
                bridge, StuckDetector(run_settings.stuck_window_s, run_settings.stuck_min_progress_m),
                run_settings.arrival_tolerance_m,
                run_settings.path_deviation_tolerance_m,
                run_settings.path_deviation_hysteresis_m,
                run_settings.path_deviation_confirmation_s,
                run_settings.path_replan_cooldown_s,
            ),
            judge=bridge, simulation=simulation, planner=planner, journal=journal,
            navigation=NavigationService(grid, estimator, run_settings, hazards), clock=clock,
            events=events, score=score, map_mode=MapMode(mission.map_mode),
            robot_id=mission.robot_id, coordination=link,
        )
        research = TerrainResearch(estimator, HypothesisBook(), hazards=hazards)
        return MissionController(mission, ports, run_settings, research, SignalSearch(),
                                 planner_rate_limited=llm_config is not None)

    initial_generation = supervisor.current_generation()
    service = RunService(environment, maps, journal, build_controller, settings,
                         initial_generation=initial_generation)
    ticker = TickLoop(service)
    ticker.start()

    app = create_app(service, environment, maps)

    @app.on_event("shutdown")
    def shutdown() -> None:
        ticker.shutdown()
        runtime.shutdown()  # перед выходом публикует нулевую скорость

    return app
