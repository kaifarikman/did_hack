"""Навигация по строящейся карте SLAM: нет карты вначале, рост карты, границы, коррекции."""
from dataclasses import replace

from application.navigation_service import NavigationService
from application.ports import MapMode
from domain.energy import TerrainEstimator
from domain.geometry import Point, Pose
from domain.grid import OBSTACLE, OccupancyGrid
from domain.mission import MissionStatus
from domain.subgoals import GoalKind, Subgoal
from fakes import FakeClock, GrowingMap, ScriptedPlanner, SimWorld, build_arena
from harness import SETTINGS, make_controller


def run_slam(controller, world, mission, slam, ticks, observe=True):
    for _ in range(ticks):
        world.advance()
        if observe:
            slam.observe()
        controller.tick()
        if mission.status.is_terminal:
            break


def test_unknown_cells_are_not_routable_and_frontier_is_at_known_boundary():
    clock = FakeClock()
    world = SimWorld(clock, [])
    slam = GrowingMap(build_arena(), lambda: world.pose, view_radius_m=1.0)
    navigation = NavigationService(slam, TerrainEstimator(), SETTINGS)
    assert not navigation.map_available and navigation.route(world.pose.point, Point(1, 1)) is None
    slam.observe()
    assert navigation.map_available
    assert navigation.route(world.pose.point, Point(2.0, 2.0)) is None  # цель в неизвестности
    frontier = navigation.frontier_points(world.pose.point)
    assert frontier and all(0.4 <= ((p.x_m + 2.0) ** 2 + (p.y_m + 0.5) ** 2) ** 0.5 <= 1.0 for p in frontier)


def test_mission_waits_for_first_map_then_explores_frontier_and_returns():
    clock = FakeClock()
    world = SimWorld(clock, [Point(-0.6, 0.6)], seed=3)
    slam = GrowingMap(build_arena(), lambda: world.pose, view_radius_m=1.5)
    controller, mission, journal = make_controller(world, clock, maps=slam, map_mode=MapMode.SLAM)
    run_slam(controller, world, mission, slam, 20, observe=False)
    assert world.linear == 0 and mission.status is MissionStatus.RUNNING
    run_slam(controller, world, mission, slam, 40000)
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 5000)]
    assert "Ожидание карты" in titles
    assert mission.status is MissionStatus.COMPLETED, mission.snapshot().last_error
    assert slam.revision > 3  # карта росла по мере разведки
    assert mission.snapshot().map_id.startswith("slam-test#r")


def test_mission_fails_honestly_if_map_never_appears():
    clock = FakeClock()
    world = SimWorld(clock, [Point(-0.6, 0.6)])
    slam = GrowingMap(build_arena(), lambda: world.pose)
    controller, mission, _ = make_controller(world, clock, maps=slam, map_mode=MapMode.SLAM)
    run_slam(controller, world, mission, slam, 400, observe=False)
    assert mission.status is MissionStatus.FAILED and mission.snapshot().last_error.code == "map_unavailable"
    assert world.linear == 0


class SwitchableMap:
    def __init__(self, grid):
        self.grid = grid

    def load(self):
        return self.grid


def test_new_obstacle_on_route_interrupts_and_replans():
    clock = FakeClock()
    world = SimWorld(clock, [Point(3.0, 2.5)])
    arena = build_arena()
    maps = SwitchableMap(arena)
    planner = ScriptedPlanner([Subgoal(GoalKind.EXPLORE, Point(1.5, -0.5), "дальняя цель", "llm")])
    controller, mission, journal = make_controller(world, clock, maps=maps, planner=planner)
    for _ in range(30):
        world.advance()
        controller.tick()
    assert mission.snapshot().current_goal is not None
    cells = list(arena.cells)
    for row in range(0, arena.height):  # стена поперёк арены на x ≈ -0.5 с проходом сверху
        if row < 50:
            cells[row * arena.width + 35] = OBSTACLE
    maps.grid = OccupancyGrid(arena.map_id, arena.resolution_m, arena.width, arena.height, arena.origin, cells, revision=1)
    world.advance()
    controller.tick()
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 500)]
    assert "Перепланирование" in titles and "План пересмотрен" in titles
    assert world.linear == 0


def test_pose_correction_discards_measurement_and_shifts_signal_history():
    clock = FakeClock()
    world = SimWorld(clock, [Point(3.0, 2.5)])
    controller, mission, journal = make_controller(world, clock)
    for _ in range(40):
        world.advance()
        controller.tick()
    before = controller._search.recent_signals()[-1][0]
    world.pose = Pose(world.pose.x_m + 0.4, world.pose.y_m, world.pose.heading_rad)  # коррекция SLAM
    world.advance()
    controller.tick()
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 500)]
    assert "Коррекция позы" in titles
    shifted = [point for point, _ in controller._search.recent_signals()]
    # сдвиг = скачок позы за тик (0.4 м коррекции + путь за тик)
    assert any(abs(point.x_m - (before.x_m + 0.4)) < 0.03 and abs(point.y_m - before.y_m) < 0.03 for point in shifted)


def test_degraded_localization_adds_return_margin():
    from domain.observations import LocalizationStatus
    clock = FakeClock()
    world = SimWorld(clock, [Point(3.0, 2.5)])
    controller, mission, _ = make_controller(world, clock)
    world.advance()
    controller.tick()
    observation = world.latest()
    assert controller._localization_margin(observation) == 1.0
    degraded = replace(observation, localization=LocalizationStatus.DEGRADED, localization_error_m=0.3)
    assert controller._localization_margin(degraded) == 1.3
