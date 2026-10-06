import math

import pytest

from domain.energy import TerrainEstimator, TravelSegment
from domain.errors import InvalidTransition
from domain.geometry import Point, Pose
from domain.grid import OccupancyGrid
from domain.hypotheses import HypothesisBook, HypothesisStatus
from domain.mission import Mission, MissionError, MissionStatus
from domain.navigation import PathTracker, StuckDetector
from domain.pathfinding import find_path, path_length_m
from domain.search import SignalSearch
from fakes import build_arena
from harness import make_mission


# ---- карта и маршруты

def test_cell_center_and_back_with_rotated_origin():
    grid = OccupancyGrid("m", 0.5, 4, 3, Pose(1.0, 2.0, math.pi / 2), [0] * 12)
    center = grid.cell_center(2, 1)
    # локально (1.25, 0.75) -> поворот на 90°: (-0.75, 1.25) + origin
    assert center.x_m == pytest.approx(0.25)
    assert center.y_m == pytest.approx(3.25)
    assert grid.world_to_cell(center) == (2, 1)
    assert grid.world_to_cell(Point(100, 100)) is None


def test_inflation_blocks_cells_near_obstacle_and_unknown():
    cells = [0] * 25
    cells[12] = 100
    cells[0] = -1
    grid = OccupancyGrid("m", 0.1, 5, 5, Pose(0, 0, 0), cells)
    blocked = grid.inflated_blocked(0.1)
    assert 12 in blocked and 11 in blocked and 7 in blocked
    assert 0 in blocked
    assert 24 not in blocked


def test_path_goes_around_pillar_keeping_clearance():
    grid = build_arena()
    blocked = grid.inflated_blocked(0.21)
    path = find_path(grid, blocked, Point(-1.0, 0.5), Point(1.0, 0.5))
    assert path is not None and path[-1] == Point(1.0, 0.5)
    assert path_length_m(Point(-1.0, 0.5), path) > 2.0 + 0.1  # обход длиннее прямой
    for waypoint in path:
        assert grid.index(*grid.world_to_cell(waypoint)) not in blocked


def test_goal_inside_inflated_margin_or_wall_is_rejected():
    grid = build_arena()
    blocked = grid.inflated_blocked(0.21)
    assert find_path(grid, blocked, Point(-1, 0), Point(-3.95, 0)) is None  # у стены
    assert find_path(grid, blocked, Point(-1, 0), Point(0.05, 0.55)) is None  # в столбе
    assert find_path(grid, blocked, Point(-1, 0), Point(50, 50)) is None  # вне карты


def test_unreachable_goal_behind_wall():
    cells = [0] * 100
    for row in range(10):
        cells[row * 10 + 5] = 100
    grid = OccupancyGrid("m", 0.1, 10, 10, Pose(0, 0, 0), cells)
    assert find_path(grid, grid.inflated_blocked(0.0), Point(0.15, 0.5), Point(0.85, 0.5)) is None


def test_expensive_terrain_is_avoided_when_detour_is_cheaper():
    grid = OccupancyGrid("m", 0.1, 40, 20, Pose(0, 0, 0), [0] * 800)
    blocked = frozenset()
    expensive = lambda p: 10.0 if 1.5 < p.x_m < 2.5 and p.y_m < 1.0 else 1.0
    path = find_path(grid, blocked, Point(0.5, 0.5), Point(3.5, 0.5), expensive)
    assert max(p.y_m for p in path) > 1.0


def test_path_tracker_turns_then_drives_and_arrives():
    tracker = PathTracker([Point(1, 0)], tolerance_m=0.1)
    turn = tracker.next_command(Pose(0, 0, math.pi))
    assert turn.linear_mps == 0 and turn.angular_radps != 0
    drive = tracker.next_command(Pose(0, 0, 0))
    assert drive.linear_mps > 0
    assert tracker.next_command(Pose(0.95, 0, 0)) is None


def test_stuck_detector_fires_without_progress_and_resets_on_progress():
    detector = StuckDetector(window_s=5, min_progress_m=0.05)
    assert not detector.is_stuck(2.0, 0)
    assert not detector.is_stuck(1.5, 4)
    assert not detector.is_stuck(1.5, 8)
    assert detector.is_stuck(1.5, 9.5)


# ---- оценка грунта

def segment(distance=1.0, drop=1.0, rotation=0.0, penalty=False, x=0.0):
    return TravelSegment(Point(x, 0), Point(x + distance, 0), distance, drop, 5.0, rotation, penalty)


def test_estimator_ignores_short_penalized_rotating_segments_and_zero_distance():
    estimator = TerrainEstimator()
    assert not estimator.record(segment(distance=0.0, drop=0.0))
    assert not estimator.record(segment(distance=0.1, drop=0.1))
    assert not estimator.record(segment(penalty=True, drop=9))
    assert not estimator.record(segment(rotation=3.0))
    assert estimator.revision == 0


def test_unmeasured_area_uses_conservative_prior_not_zero():
    estimator = TerrainEstimator(prior_energy_per_m=1.5)
    estimate = estimator.estimate_at(Point(5, 5))
    assert estimate.energy_per_m == 1.5 and estimate.confidence == 0 and not estimate.measured
    assert estimator.conservative_energy_per_m(Point(5, 5)) > 1.5


def test_estimate_moves_toward_measurement_and_confidence_grows():
    estimator = TerrainEstimator(prior_energy_per_m=1.0)
    estimator.record(segment(distance=1.0, drop=3.0))
    first = estimator.estimate_at(Point(0.5, 0))
    estimator.record(segment(distance=1.0, drop=3.0))
    second = estimator.estimate_at(Point(0.5, 0))
    assert 2.0 < first.energy_per_m < 3.0
    assert second.energy_per_m > first.energy_per_m and second.confidence > first.confidence


def test_path_energy_is_larger_through_expensive_zone():
    estimator = TerrainEstimator(prior_energy_per_m=1.0)
    for x in (0.0, 1.0, 2.0):
        estimator.record(segment(drop=1.0 if x != 1.0 else 4.0, x=x))
    through = estimator.path_energy(Point(0.0, 0), [Point(3.0, 0)])
    outside = estimator.path_energy(Point(0.0, 5), [Point(3.0, 5)])
    assert through > 0 and outside > 0


# ---- гипотеза

def build_estimator_with_expensive_zone() -> TerrainEstimator:
    estimator = TerrainEstimator(prior_energy_per_m=1.0)
    for x, drop in ((0.0, 1.0), (1.0, 1.0), (2.0, 3.5), (3.0, 1.0)):
        estimator.record(segment(drop=drop, x=x))
        estimator.record(segment(drop=drop, x=x))
    return estimator


def test_hypothesis_proposed_tested_and_confirmed_by_new_measurement():
    estimator = build_estimator_with_expensive_zone()
    book = HypothesisBook()
    hypothesis = book.propose(estimator)
    assert hypothesis is not None and hypothesis.center.x_m == pytest.approx(2.75, abs=0.3)
    book.start_experiment(hypothesis, estimator)
    assert book.evaluate(hypothesis, estimator) is None  # измерений ещё нет
    estimator.record(segment(drop=3.6, x=hypothesis.center.x_m - 0.5))
    assert book.evaluate(hypothesis, estimator) is HypothesisStatus.CONFIRMED
    assert hypothesis.measured_energy_per_m == pytest.approx(3.6)


def test_hypothesis_refuted_and_unverified_after_attempt_limit():
    estimator = build_estimator_with_expensive_zone()
    book = HypothesisBook(max_attempts=1)
    hypothesis = book.propose(estimator)
    book.start_experiment(hypothesis, estimator)
    estimator.record(segment(drop=1.0, x=hypothesis.center.x_m - 0.5))
    assert book.evaluate(hypothesis, estimator) is HypothesisStatus.REFUTED
    second = HypothesisBook(max_attempts=1)
    other = second.propose(estimator)
    second.start_experiment(other, estimator)
    assert second.give_up_or_retry(other) is HypothesisStatus.UNVERIFIED
    assert other.measured_energy_per_m is None


def test_no_hypothesis_without_baseline_comparison():
    estimator = TerrainEstimator()
    estimator.record(segment(drop=5.0))
    assert HypothesisBook().propose(estimator) is None


# ---- поиск

def test_search_ranks_candidate_in_gradient_direction_first():
    search = SignalSearch()
    for x, signal in ((0.0, 0.1), (0.3, 0.2), (0.6, 0.35), (0.9, 0.5)):
        search.record_signal(Point(x, 0.0 + x * 0.01), signal)
    ahead, behind = Point(1.8, 0.0), Point(-0.9, 0.0)
    ranked = search.rank_candidates([behind, ahead], Point(0.9, 0.0), 0.5, 3.0)
    assert ranked[0].point == ahead


def test_search_excludes_points_near_failed_collects_and_resets_after_success():
    search = SignalSearch()
    search.record_signal(Point(0, 0), 0.9)
    search.record_collect_attempt(Point(1, 0))
    ranked = search.rank_candidates([Point(1.1, 0), Point(2, 0)], Point(0, 0), 0.5, 3.0)
    assert [c.point for c in ranked] == [Point(2, 0)]
    assert search.total_collect_attempts == 1
    search.reset_after_collect()
    assert search.best_signal is None and search.recent_signals() == ()


# ---- жизненный цикл

def test_valid_and_invalid_transitions():
    mission = make_mission()
    mission.mark_running()
    with pytest.raises(InvalidTransition):
        mission.mark_running()
    mission.begin_return()
    mission.request_stop()
    assert mission.status is MissionStatus.STOPPING
    mission.request_stop()  # повторная остановка без эффекта
    revision = mission.snapshot().revision
    mission.request_stop()
    assert mission.snapshot().revision == revision
    mission.confirm_stopped()
    mission.request_stop()
    assert mission.status is MissionStatus.STOPPED
    with pytest.raises(InvalidTransition):
        mission.begin_return()


def test_completed_requires_sample_positive_battery_and_judge():
    mission = make_mission()
    mission.mark_running()
    mission.begin_return()
    mission.update_telemetry(1.0, Pose(0, 0, 0), 10.0, None)
    with pytest.raises(InvalidTransition):
        mission.complete(True)  # нет подтверждённого сбора
    mission.add_collected_sample(Point(1, 1))
    with pytest.raises(InvalidTransition):
        mission.complete(False)  # судья не подтвердил
    mission.update_telemetry(2.0, Pose(0, 0, 0), 0.0, None)
    with pytest.raises(InvalidTransition):
        mission.complete(True)  # батарея нулевая
    mission.update_telemetry(3.0, Pose(0, 0, 0), 5.0, None)
    mission.complete(True)
    assert mission.status is MissionStatus.COMPLETED


def test_revision_monotonic_snapshot_immutable_and_failure_terminal():
    mission = make_mission()
    first = mission.snapshot()
    mission.update_telemetry(1.0, Pose(1, 1, 0), 50.0, 0.3)
    second = mission.snapshot()
    assert second.revision > first.revision
    assert first.robot_pose is None and first.battery_remaining is None
    mission.fail(MissionError("x", "y"))
    mission.fail(MissionError("z", "w"))  # терминальное состояние не перезаписывается
    assert mission.snapshot().last_error.code == "x"
    assert mission.status is MissionStatus.FAILED
