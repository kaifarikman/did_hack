"""Сборка контроллера и сервиса прогона на двойниках."""
from __future__ import annotations

from adapters.journal.memory import InMemoryJournal
from application.mission_controller import ControllerPorts, MissionController
from application.motion import MotionExecutor
from application.navigation_service import NavigationService
from application.planner import FallbackPlanner, ResilientPlanner
from application.run_service import RunService
from domain.energy import TerrainEstimator
from domain.hypotheses import HypothesisBook
from domain.mission import Mission
from domain.navigation import StuckDetector
from domain.search import SignalSearch
from domain.settings import MissionSettings
from fakes import FakeClock, FakeEnvironment, SimWorld, StaticMap, build_arena

SETTINGS = MissionSettings()


def make_mission(run_id: str = "run-1") -> Mission:
    return Mission(run_id, "easy", 1, "local", "fallback", "test-arena", SETTINGS.base, SETTINGS.battery_initial)


def make_controller(world: SimWorld, clock: FakeClock, journal=None, planner=None, mission=None,
                    settings: MissionSettings = SETTINGS, simulation=None, estimator=None, judge=None,
                    events=None, score=None):
    journal = journal or InMemoryJournal()
    mission = mission or make_mission()
    estimator = estimator or TerrainEstimator()
    ports = ControllerPorts(
        observations=world,
        motion=MotionExecutor(world, StuckDetector(), settings.arrival_tolerance_m),
        judge=judge or world,
        simulation=simulation or world,
        planner=planner or ResilientPlanner(None, FallbackPlanner(settings)),
        journal=journal,
        navigation=NavigationService(build_arena(), estimator, settings),
        clock=clock,
        events=events,
        score=score,
    )
    controller = MissionController(mission, ports, settings, estimator, SignalSearch(), HypothesisBook())
    return controller, mission, journal


def run_ticks(controller, world, mission, max_ticks: int = 30000, dt_s: float = 0.1) -> int:
    for tick in range(max_ticks):
        world.advance(dt_s)
        controller.tick()
        if mission.status.is_terminal:
            return tick
    return max_ticks


def make_service(world: SimWorld, clock: FakeClock, journal=None, environment=None, ids=None):
    journal = journal or InMemoryJournal()
    environment = environment or FakeEnvironment()
    maps = StaticMap()
    counter = iter(range(1, 1000))

    def factory(mission: Mission) -> MissionController:
        controller, _, _ = make_controller(world, clock, journal=journal, mission=mission)
        return controller

    service = RunService(environment, maps, journal, factory, SETTINGS,
                         id_factory=ids or (lambda: f"run-{next(counter)}"))
    return service, environment, maps, journal
