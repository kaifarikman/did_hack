"""Офлайн-стенд B: настоящий HTTP backend и ядро на подменной среде, без ROS и Gazebo.

Нужен, чтобы проверять ядро, панель и экспорт автономно (общий стенд Gazebo принадлежит A).
Это не физическая проверка: мир — `backend/tests/fakes.py`, сценарии — `fake_scenarios.py`.
В hard подменная среда скрыто меняет грунт, добавляет опасность и сбой датчика.

Запуск:
    PYTHONPATH=backend/src:backend/tests backend/.venv/bin/python scripts/analysis/offline_stand.py
    cd frontend && BACKEND_URL=http://localhost:8010 npm run dev
Переменные: STAND_PORT (8010), STAND_SPEEDUP (3 — во сколько раз быстрее реального времени),
LLM_* — как у основного backend; без них работает алгоритмический резерв.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import uvicorn

from fake_scenarios import make_world

from adapters.http.app import create_app
from adapters.journal.jsonl import JsonlJournal
from adapters.llm.config import LlmConfig
from adapters.llm.openai_planner import OpenAiCompatiblePlanner
from application.mission_controller import ControllerPorts, MissionController
from application.motion import MotionExecutor
from application.navigation_service import NavigationService
from application.planner import FallbackPlanner, ResilientPlanner
from application.ports import ResetAck, ResetRequest
from application.research import TerrainResearch
from application.run_service import RunService
from domain.energy import TerrainEstimator
from domain.geometry import Point
from domain.hazards import HazardMap
from domain.hypotheses import HypothesisBook
from domain.mission import Mission
from domain.navigation import StuckDetector
from domain.profiles import settings_for_profile
from domain.search import SignalSearch
from domain.settings import MissionSettings
from fakes import FakeClock, FakeEnvironment, StaticMap, WorldChange, Zone, build_arena

ROOT = Path(__file__).resolve().parents[2]
TICK_S = 0.1


class SwitchingWorld:
    """Порты робота и судьи; reset создаёт новый мир выбранного профиля и seed."""

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.world = make_world("easy", 1)
        self.lock = threading.RLock()

    def reset(self, request: ResetRequest) -> ResetAck:
        with self.lock:
            world = make_world(request.scenario, request.seed)
            world.clock = self.clock
            if request.scenario == "hard":
                hidden = [
                    (90.0, WorldChange("terrain_up", zone_index=0, zone_energy_per_m=5.0)),
                    (60.0, WorldChange("hazard", hazard=Zone(Point(-1.2, 0.4), 0.3, 0.0))),
                    (150.0, WorldChange("sensor_noise", sensor_mode="noisy", sensor_noise=0.25)),
                    (175.0, WorldChange("sensor_ok", sensor_mode="ok")),
                ]
                world._schedule = sorted(hidden, key=lambda item: item[0])
            self.world = world
            return world.reset(request)

    def __getattr__(self, name: str):
        return getattr(self.world, name)


def build() -> tuple[RunService, SwitchingWorld]:
    clock = FakeClock()
    world = SwitchingWorld(clock)
    llm_config = LlmConfig.from_environment()
    environment = FakeEnvironment(llm=llm_config is not None, scenarios=("easy", "medium", "hard"))
    maps = StaticMap(build_arena())
    journal = JsonlJournal(ROOT / "artifacts" / "analysis" / "offline-stand" / "journal")
    base = MissionSettings()

    def build_controller(mission: Mission) -> MissionController:
        settings = settings_for_profile(mission.scenario, base)
        estimator, hazards = TerrainEstimator(), HazardMap()
        planner = ResilientPlanner(OpenAiCompatiblePlanner(llm_config) if llm_config else None, FallbackPlanner(settings))
        ports = ControllerPorts(
            observations=world, motion=MotionExecutor(world, StuckDetector(), settings.arrival_tolerance_m),
            judge=world, simulation=world, planner=planner, journal=journal,
            navigation=NavigationService(maps.grid, estimator, settings, hazards), clock=clock,
            events=world, score=world,
        )
        return MissionController(mission, ports, settings, TerrainResearch(estimator, HypothesisBook(), hazards=hazards),
                                 SignalSearch(), planner_rate_limited=llm_config is not None)

    return RunService(environment, maps, journal, build_controller, base), world


def run_loop(service: RunService, world: SwitchingWorld, speedup: float, stop: threading.Event) -> None:
    """Один поток двигает мир и тикает контроллер: без гонок между физикой и решениями."""
    while not stop.is_set():
        started = time.monotonic()
        for _ in range(max(1, round(speedup))):
            with world.lock:
                world.advance(TICK_S)
                service.tick()
        stop.wait(max(0.0, TICK_S - (time.monotonic() - started)))


def main() -> None:
    service, world = build()
    stop = threading.Event()
    threading.Thread(target=run_loop, args=(service, world, float(os.environ.get("STAND_SPEEDUP", "3")), stop),
                     daemon=True, name="stand-loop").start()
    app = create_app(service, service._environment, service._maps)
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("STAND_PORT", "8010")), log_level="warning")
    stop.set()


if __name__ == "__main__":
    main()
