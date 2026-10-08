"""D1-live-2: попадания известной стены не закрывают цель у стены.

Scan, спроецированный позой другого момента, сдвигает дальнюю стену в свободное пространство.
Bridge проецирует scan позой своего момента (`PoseHistory`), а overlay отбрасывает попадания,
объяснимые картой с допуском по дальности.
"""
from __future__ import annotations

import math
from dataclasses import replace
from pathlib import Path

import pytest

from adapters.map_file import load_nav2_map
from adapters.ros.conversion import PoseHistory
from application.navigation_goal import TargetProblem, assess_navigation_target
from application.navigation_service import NavigationService
from domain.energy import TerrainEstimator
from domain.geometry import Point, Pose
from domain.grid import OccupancyGrid
from domain.settings import MissionSettings

SETTINGS = MissionSettings()
# поведение до D1-live-2: без сопоставления с картой, без предела дальности и без растрового запаса
UNFILTERED = replace(SETTINGS, static_hit_match_max_m=0.0, dynamic_obstacle_max_range_m=math.inf,
                     planning_raster_margin_m=0.0)
REAL_MAP = Path(__file__).resolve().parents[2] / "simulation" / "judge" / "data" / "map.yaml"
LIVE_TARGET = Point(-0.987, -1.979)  # цель прогона 68aacfc5…, ~0.45 м от стены арены
LIVE_ROBOT = Pose(-1.80, -0.77, -0.98)  # поза в момент ложного «препятствия у цели»


def skewed_scan(grid: OccupancyGrid, pose: Pose, heading_error_rad: float) -> tuple[Point, ...]:
    """Лучи по истинному курсу, проекция с ошибкой курса."""
    points = []
    for degree in range(0, 360, 2):
        true_angle = pose.heading_rad + math.radians(degree)
        for step in range(3, 400):
            distance = step * 0.01
            probe = Point(pose.x_m + distance * math.cos(true_angle), pose.y_m + distance * math.sin(true_angle))
            cell = grid.world_to_cell(probe)
            if cell is None or grid.cells[grid.index(*cell)] != 0:
                projected = true_angle + heading_error_rad
                points.append(Point(pose.x_m + distance * math.cos(projected),
                                    pose.y_m + distance * math.sin(projected)))
                break
    return tuple(points)


def observe(grid, settings, scan, origin) -> NavigationService:
    navigation = NavigationService(grid, TerrainEstimator(), settings)
    for now_s in (10.0, 10.1):
        navigation.observe_dynamic_obstacles(scan, now_s, origin)
    return navigation


@pytest.fixture(scope="module")
def real_grid() -> OccupancyGrid:
    if not REAL_MAP.exists():
        pytest.skip("нет карты simulation/judge/data/map.yaml")
    return load_nav2_map(REAL_MAP)


def test_live_case_skew_closed_target_without_map_matching_and_not_with_it(real_grid):
    scan = skewed_scan(real_grid, LIVE_ROBOT, 0.1)
    unmatched = observe(real_grid, UNFILTERED, scan, LIVE_ROBOT.point)
    matched = observe(real_grid, SETTINGS, scan, LIVE_ROBOT.point)
    before = assess_navigation_target(unmatched, SETTINGS, LIVE_ROBOT.point, LIVE_TARGET, 60.0)
    assert before.problem is TargetProblem.OCCUPIED_NOW  # механизм дефекта воспроизведён
    assert assess_navigation_target(matched, SETTINGS, LIVE_ROBOT.point, LIVE_TARGET, 60.0).accepted


def test_scan_projected_with_its_own_pose_keeps_target_open(real_grid):
    scan = skewed_scan(real_grid, LIVE_ROBOT, 0.0)
    navigation = observe(real_grid, SETTINGS, scan, LIVE_ROBOT.point)
    assert assess_navigation_target(navigation, SETTINGS, LIVE_ROBOT.point, LIVE_TARGET, 60.0).accepted


RUN1_BASE = Pose(-1.957, -0.538, -0.2)  # прогон 317a016c…: робот так и не уехал с базы
RUN1_TARGET = Point(-0.747, -1.99)  # ≥0.5 м от любых препятствий карты


def test_run1_far_wall_skew_closed_target_and_is_now_ignored(real_grid):
    scan = skewed_scan(real_grid, RUN1_BASE, 0.15)
    before = observe(real_grid, UNFILTERED, scan, RUN1_BASE.point)
    assert assess_navigation_target(before, SETTINGS, RUN1_BASE.point, RUN1_TARGET, 60.0).problem \
        is TargetProblem.OCCUPIED_NOW
    after = observe(real_grid, SETTINGS, scan, RUN1_BASE.point)
    assert assess_navigation_target(after, SETTINGS, RUN1_BASE.point, RUN1_TARGET, 60.0).accepted


@pytest.mark.parametrize("heading", [-2.4, -1.2, 0.0, 1.2, 2.4])
@pytest.mark.parametrize("skew", [-0.25, 0.25])
def test_stress_skew_never_closes_demo_targets(real_grid, heading, skew):
    for robot_point in (Point(-1.957, -0.538), Point(-1.5, -1.0), Point(-1.2, -1.6), Point(0.0, -0.5)):
        robot = Pose(robot_point.x_m, robot_point.y_m, heading)
        navigation = observe(real_grid, SETTINGS, skewed_scan(real_grid, robot, skew), robot.point)
        for target in (RUN1_TARGET, LIVE_TARGET, Point(0.5, 0.5), Point(0.5, -1.5), Point(1.6, 1.6)):
            assert navigation.is_reachable(target), (robot_point, target)


def test_new_obstacle_in_open_space_still_enters_overlay(real_grid):
    robot = Point(-1.8, -0.77)
    for box in (Point(-1.5, -0.5), Point(-0.55, -0.55)):  # 0.4 и 1.27 м от робота, вдали от карты
        assert NavigationService(real_grid, TerrainEstimator(), SETTINGS).is_statically_reachable(box)
        assert not observe(real_grid, SETTINGS, (box,), robot).is_reachable(box), box


def test_far_hit_skips_planning_overlay_but_near_hit_still_brakes(real_grid):
    robot = Pose(-1.957, -0.538, 0.0)
    far_box = Point(-0.3, -0.5)  # 1.66 м от базы: дальше предела overlay
    assert NavigationService(real_grid, TerrainEstimator(), SETTINGS).is_statically_reachable(far_box)
    navigation = observe(real_grid, SETTINGS, (far_box,), robot.point)
    assert navigation.is_reachable(far_box)
    assert not observe(real_grid, SETTINGS, (far_box,), Point(-1.2, -0.5)).is_reachable(far_box)  # ближе — учтена
    near_wall_box = Point(-1.6, -0.2)  # объяснима картой: в overlay не входит
    navigation = observe(real_grid, SETTINGS, (near_wall_box,), robot.point)
    braking_pose = Pose(-1.6, -0.45, math.pi / 2)  # едет прямо на точку в 0.25 м
    assert navigation.command_blocked(braking_pose, 0.15, 0.0, 0.05, 10.1)


def test_pose_history_interpolates_heading_at_scan_time():
    history = PoseHistory()
    history.add(2.0, Pose(0.0, 0.0, 3.0))
    history.add(2.2, Pose(0.2, 0.0, -3.0))  # через ±π
    middle = history.at(2.1)
    assert middle.x_m == pytest.approx(0.1)
    assert abs(math.atan2(math.sin(middle.heading_rad - math.pi), math.cos(middle.heading_rad - math.pi))) < 1e-6
    assert history.at(2.22) == Pose(0.2, 0.0, -3.0)  # чуть новее последней odom — последняя
    assert history.at(5.0) is None and history.at(1.0) is None


def test_pose_history_resets_when_time_goes_back_and_trims_horizon():
    history = PoseHistory(horizon_s=1.0)
    for step in range(30):
        history.add(step * 0.1, Pose(step * 0.1, 0.0, 0.0))
    assert history.at(0.5) is None and history.at(2.5) is not None
    history.add(0.1, Pose(9.0, 9.0, 0.0))  # новый прогон: часы сброшены
    assert history.at(0.1) == Pose(9.0, 9.0, 0.0) and history.at(2.5) is None


class RayCastWorld:
    """SimWorld с lidar по реальной карте; scan проецируется курсом, сдвинутым на ω·skew_s."""

    def __new__(cls, grid: OccupancyGrid, skew_s: float):
        from dataclasses import replace as replace_observation

        from fakes import FakeClock, SimWorld

        class _World(SimWorld):
            def latest(self):
                observation = super().latest()
                skew = self.angular * skew_s
                points = []
                for degree in range(0, 360, 3):
                    angle = self.pose.heading_rad + math.radians(degree)
                    for step in range(3, 350, 2):
                        distance = step * 0.01
                        probe = Point(self.pose.x_m + distance * math.cos(angle),
                                      self.pose.y_m + distance * math.sin(angle))
                        cell = grid.world_to_cell(probe)
                        if cell is None:
                            break
                        if grid.cells[grid.index(*cell)] != 0:
                            points.append(Point(self.pose.x_m + distance * math.cos(angle + skew),
                                                self.pose.y_m + distance * math.sin(angle + skew)))
                            break
                return replace_observation(observation, scan_obstacles=tuple(points))

        return _World(FakeClock(), [Point(3.0, 3.0)])


@pytest.mark.parametrize("target", [RUN1_TARGET, Point(0.5, 0.5)])
def test_real_map_navigation_with_skewed_lidar_completes(real_grid, target):
    """Сквозная проверка: столбы и стены видны lidar, scan запаздывает на 0.2 с по курсу."""
    from domain.mission import MissionStatus
    from domain.navigation_task import NavigationTarget
    from fakes import StaticMap
    from test_navigation import Stack

    stack = Stack(world=RayCastWorld(real_grid, 0.2), maps=StaticMap(real_grid))
    stack.start(goal=NavigationTarget(target, real_grid.versioned_id))
    final = stack.run(max_ticks=3000)
    assert final.status is MissionStatus.COMPLETED, (final.last_error, stack.titles(final.run_id))
    assert "Путь к цели закрыт" not in stack.titles(final.run_id)


def ray_cast_world(grid: OccupancyGrid, skew_s: float):
    """SimWorld с lidar по реальной карте; scan проецируется курсом, сдвинутым на ω·skew_s."""
    from fakes import FakeClock, SimWorld

    class RayCastWorld(SimWorld):
        def latest(self):
            observation = super().latest()
            skew = self.angular * skew_s
            points = []
            for degree in range(0, 360, 3):
                angle = self.pose.heading_rad + math.radians(degree)
                for step in range(3, 350, 2):
                    distance = step * 0.01
                    cell = grid.world_to_cell(Point(self.pose.x_m + distance * math.cos(angle),
                                                    self.pose.y_m + distance * math.sin(angle)))
                    if cell is None:
                        break
                    if grid.cells[grid.index(*cell)] != 0:
                        points.append(Point(self.pose.x_m + distance * math.cos(angle + skew),
                                            self.pose.y_m + distance * math.sin(angle + skew)))
                        break
            return replace(observation, scan_obstacles=tuple(points))

    return RayCastWorld(FakeClock(), [Point(3.0, 3.0)])


@pytest.mark.parametrize("target", [RUN1_TARGET, Point(0.5, 0.5)])
def test_real_map_navigation_with_skewed_lidar_completes(real_grid, target):
    """Сквозная проверка: столбы и стены видны lidar, scan запаздывает на 0.2 с по курсу."""
    from domain.mission import MissionStatus
    from domain.navigation_task import NavigationTarget
    from fakes import StaticMap
    from test_navigation import Stack

    stack = Stack(world=ray_cast_world(real_grid, 0.2), maps=StaticMap(real_grid))
    stack.start(goal=NavigationTarget(target, real_grid.versioned_id))
    final = stack.run(max_ticks=3000)
    assert final.status is MissionStatus.COMPLETED, (final.last_error, stack.titles(final.run_id))
    assert "Путь к цели закрыт" not in stack.titles(final.run_id)
