import pytest

from application.motion import MotionExecutor, MotionState
from application.navigation_service import NavigationService
from domain.energy import TerrainEstimator
from domain.geometry import Point, Pose
from domain.navigation import StuckDetector
from domain.settings import MissionSettings
from fakes import build_arena


class Drive:
    def __init__(self):
        self.commands = []

    def command(self, linear_mps, angular_radps):
        self.commands.append((linear_mps, angular_radps))

    def stop(self):
        self.commands.append((0.0, 0.0))


def test_live_scan_overlay_detours_and_expires_by_ttl():
    grid = build_arena()
    service = NavigationService(grid, TerrainEstimator(), MissionSettings())
    start, goal = Point(-1.0, 1.5), Point(1.0, 1.5)
    baseline = service.route(start, goal)
    assert baseline is not None
    assert baseline.length_m == pytest.approx(2.0)

    assert not service.observe_dynamic_obstacles((Point(0.0, 1.5),), now_s=10.0)
    assert service.observe_dynamic_obstacles((Point(0.0, 1.5),), now_s=10.1)
    detour = service.route(start, goal)
    assert detour is not None and detour.length_m > baseline.length_m + 0.04
    assert service.path_blocked(start, (goal,))

    assert service.observe_dynamic_obstacles((), now_s=11.2)
    expired = service.route(start, goal)
    assert expired is not None
    assert expired.length_m == pytest.approx(baseline.length_m)


def test_stopping_corridor_accounts_for_speed_scan_age_and_clearance():
    service = NavigationService(build_arena(), TerrainEstimator(), MissionSettings())
    pose = Pose(-1.0, 1.5, 0.0)
    service.observe_dynamic_obstacles((Point(-0.75, 1.5),), now_s=5.0)
    assert service.command_blocked(pose, 0.15, 0.0, scan_age_s=0.1, now_s=5.1)
    far_service = NavigationService(build_arena(), TerrainEstimator(), MissionSettings())
    far_service.observe_dynamic_obstacles((Point(-0.5, 1.5),), now_s=5.0)
    assert not far_service.command_blocked(pose, 0.15, 0.0, scan_age_s=0.1, now_s=5.1)


def test_recovery_rotation_requires_static_map_clearance():
    grid = build_arena()
    service = NavigationService(grid, TerrainEstimator(), MissionSettings())
    occupied_index = next(index for index, value in enumerate(grid.cells) if value != 0)
    row, column = divmod(occupied_index, grid.width)
    occupied = grid.cell_center(column, row)
    assert service.recovery_command_blocked(Pose(occupied.x_m, occupied.y_m, 0.0),
                                            0.0, 0.4, scan_age_s=0.0, now_s=1.0)

    clear = Pose(-1.0, 1.5, 0.0)
    assert not service.recovery_command_blocked(clear, 0.0, 0.4, scan_age_s=0.0, now_s=1.0)


def test_motion_executor_stops_and_reports_dynamic_blockage():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(), tolerance_m=0.1)
    motion.follow([Point(1.0, 0.0)])

    result = motion.step(Pose(0.0, 0.0, 0.0), 1.0,
                         command_blocked=lambda command: command.linear_mps > 0)

    assert result is MotionState.BLOCKED
    assert drive.commands[-1] == (0.0, 0.0)


def test_motion_stuck_watchdog_counts_only_commanded_translation():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(window_s=5, min_progress_m=0.05), tolerance_m=0.1)
    motion.follow([Point(1.0, 0.0)], start=Point(0.0, 0.0))

    assert motion.step(Pose(0.0, 0.0, 2.0), 0.0) is MotionState.MOVING  # rotate in place
    assert motion.step(Pose(0.0, 0.0, 1.0), 20.0) is MotionState.MOVING
    assert motion.step(Pose(0.0, 0.0, 0.0), 20.1) is MotionState.MOVING  # translation starts
    assert motion.step(Pose(0.0, 0.0, 0.0), 24.9) is MotionState.MOVING
    assert motion.step(Pose(0.0, 0.0, 0.0), 25.2) is MotionState.STUCK


def test_recovery_reverses_then_turns_and_stops_on_completion():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(), tolerance_m=0.1)
    motion.begin_recovery(Pose(0.0, 0.0, 0.0), 1.0, reverse_m=0.12, turn_rad=0.6,
                          reverse_speed_mps=0.06, turn_speed_radps=0.4, timeout_s=4.0)

    assert motion.step(Pose(0.0, 0.0, 0.0), 1.1, lambda _command: False) is MotionState.RECOVERING
    assert drive.commands[-1] == (-0.06, 0.0)
    assert motion.step(Pose(-0.12, 0.0, 0.0), 1.5, lambda _command: False) is MotionState.RECOVERING
    assert drive.commands[-1] == (0.0, 0.0)
    assert motion.step(Pose(-0.12, 0.0, 0.0), 1.6, lambda _command: False) is MotionState.RECOVERING
    assert drive.commands[-1] == (0.0, 0.4)
    assert motion.step(Pose(-0.12, 0.0, 0.3), 2.0, lambda _command: False) is MotionState.RECOVERING
    assert motion.step(Pose(-0.12, 0.0, 0.6), 2.5, lambda _command: False) is MotionState.RECOVERED
    assert drive.commands[-1] == (0.0, 0.0)


def test_recovery_refuses_occupied_retreat_and_times_out():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(), tolerance_m=0.1)
    motion.begin_recovery(Pose(0.0, 0.0, 0.0), 1.0, reverse_m=0.12, turn_rad=0.6,
                          reverse_speed_mps=0.06, turn_speed_radps=0.4, timeout_s=1.0)
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.1, lambda command: command.linear_mps < 0) \
        is MotionState.RECOVERY_FAILED
    assert drive.commands[-1] == (0.0, 0.0)

    motion.begin_recovery(Pose(0.0, 0.0, 0.0), 2.0, reverse_m=0.12, turn_rad=0.6,
                          reverse_speed_mps=0.06, turn_speed_radps=0.4, timeout_s=1.0)
    assert motion.step(Pose(0.0, 0.0, 0.0), 3.0, lambda _command: False) is MotionState.RECOVERY_FAILED


def test_motion_executor_replans_after_sustained_cross_track_deviation():
    drive = Drive()
    motion = MotionExecutor(
        drive, StuckDetector(), tolerance_m=0.1,
        path_deviation_tolerance_m=0.3,
        path_deviation_confirmation_s=0.6,
        path_replan_cooldown_s=2.0,
    )
    motion.follow([Point(2.0, 0.0)], start=Point(0.0, 0.0))
    pose = Pose(0.0, 0.5, 0.0)
    assert motion.step(pose, 1.0) is MotionState.MOVING
    assert motion.step(pose, 1.5) is MotionState.MOVING
    assert motion.step(pose, 1.61) is MotionState.OFF_PATH
    assert drive.commands[-1] == (0.0, 0.0)

    motion.follow([Point(2.0, 0.0)], start=pose.point)
    assert motion.step(pose, 1.7) is MotionState.MOVING
    assert motion.step(pose, 1.8, command_blocked=lambda _command: True) is MotionState.BLOCKED


def test_refreshing_one_sensor_hit_does_not_revise_overlay_every_scan():
    service = NavigationService(build_arena(), TerrainEstimator(), MissionSettings())
    point = Point(0.0, 1.5)

    assert not service.observe_dynamic_obstacles((point,), now_s=10.0)
    pose = Pose(-0.2, 1.5, 0.0)
    assert service.command_blocked(pose, 0.15, 0.0, scan_age_s=0.05, now_s=10.0)
    assert service.dynamic_obstacle_revision == 0
    assert service.observe_dynamic_obstacles((point,), now_s=10.1)
    initial_revision = service.dynamic_obstacle_revision
    assert not service.observe_dynamic_obstacles((point,), now_s=10.2)
    assert service.dynamic_obstacle_revision == initial_revision

    assert not service.observe_dynamic_obstacles((), now_s=10.3)
    assert service.dynamic_obstacle_revision == initial_revision
    assert service.observe_dynamic_obstacles((), now_s=11.2)
    assert service.dynamic_obstacle_revision == initial_revision + 1


def test_sensor_jitter_inside_coarse_cell_does_not_change_overlay_revision():
    service = NavigationService(
        build_arena(), TerrainEstimator(),
        MissionSettings(dynamic_obstacle_cell_m=0.2),
    )
    assert not service.observe_dynamic_obstacles((Point(0.01, 1.51),), now_s=10.0)
    assert service.observe_dynamic_obstacles((Point(0.09, 1.59),), now_s=10.1)
    initial_revision = service.dynamic_obstacle_revision

    assert not service.observe_dynamic_obstacles((Point(0.02, 1.52),), now_s=10.2)
    assert service.dynamic_obstacle_revision == initial_revision


def test_blocked_forward_turn_first_aligns_in_place_then_reports_blocked():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(6.0, 0.05), 0.12)
    motion.follow([Point(1.0, 0.4)], start=Point(0.0, 0.0))  # курс 0, сегмент под ~0.38 рад: ход с подворотом
    forward_blocked = lambda command: command.linear_mps > 0  # noqa: E731 — препятствие только для хода
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.0, command_blocked=forward_blocked) is MotionState.MOVING
    linear, angular = drive.commands[-1]
    assert linear == 0.0 and angular > 0  # доворот на месте к сегменту, без поступательного хода
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.1, command_blocked=lambda command: True) is MotionState.BLOCKED
    assert drive.commands[-1] == (0.0, 0.0)


def test_aligned_heading_with_obstacle_ahead_is_blocked_not_spinning():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(6.0, 0.05), 0.12)
    motion.follow([Point(1.0, 0.0)], start=Point(0.0, 0.0))
    forward_blocked = lambda command: command.linear_mps > 0  # noqa: E731
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.0, command_blocked=forward_blocked) is MotionState.BLOCKED


def test_blocked_forward_turn_first_aligns_in_place_then_reports_blocked():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(6.0, 0.05), 0.12)
    motion.follow([Point(1.0, 0.4)], start=Point(0.0, 0.0))  # сегмент под ~0.38 рад: ход с подворотом
    forward_blocked = lambda command: command.linear_mps > 0  # noqa: E731
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.0, command_blocked=forward_blocked) is MotionState.MOVING
    linear, angular = drive.commands[-1]
    assert linear == 0.0 and angular > 0  # доворот на месте, без поступательного хода
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.1, command_blocked=lambda command: True) is MotionState.BLOCKED
    assert drive.commands[-1] == (0.0, 0.0)


def test_aligned_heading_with_obstacle_ahead_is_blocked_not_spinning():
    drive = Drive()
    motion = MotionExecutor(drive, StuckDetector(6.0, 0.05), 0.12)
    motion.follow([Point(1.0, 0.0)], start=Point(0.0, 0.0))
    forward_blocked = lambda command: command.linear_mps > 0  # noqa: E731
    assert motion.step(Pose(0.0, 0.0, 0.0), 1.0, command_blocked=forward_blocked) is MotionState.BLOCKED
