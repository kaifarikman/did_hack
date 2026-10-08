"""Поиск нескольких образцов и энергетическая политика через публичные интерфейсы."""
from dataclasses import replace

import pytest

from application.navigation_service import NavigationService
from application.validation import validate_subgoal
from domain.energy import TerrainEstimator
from domain.geometry import Point
from domain.mission import MissionStatus
from domain.observations import LocalizationStatus
from domain.policy import decide_subgoal
from domain.profiles import PUBLIC_PROFILES, settings_for_profile
from domain.search import SignalSearch
from domain.settings import MissionSettings
from domain.subgoals import Candidate, GoalKind, Subgoal
from domain.target_selection import rank_by_utility
from fakes import FakeClock, SimWorld, build_arena
from harness import SETTINGS, make_controller, run_ticks
from test_llm import context as base_context


def straight(start, end):
    return abs(start.x_m - end.x_m) + abs(start.y_m - end.y_m)


def test_profiles_use_public_sample_counts():
    for name, rules in PUBLIC_PROFILES.items():
        assert settings_for_profile(name, SETTINGS).target_samples == rules.sample_count
    assert [PUBLIC_PROFILES[name].sample_count for name in ("easy", "medium", "hard")] == [3, 5, 7]


def test_utility_drops_targets_without_guaranteed_return_and_prefers_cheap_nearby():
    robot, base = Point(0, 0), Point(-2, 0)
    near, far, unreachable = Point(1, 0), Point(3, 0), Point(9, 0)
    candidates = [Candidate(far, 1.2, 0.2), Candidate(near, 1.0, 0.2), Candidate(unreachable, 5.0, 0.9)]
    ranked = rank_by_utility(candidates, robot, base, battery=15.0, battery_initial=60.0, reserve=3.0,
                             energy_along=straight, energy_price=0.15)
    assert [c.point for c in ranked] == [near, far]
    assert ranked[0].energy_to == 1 and ranked[0].energy_back == 3
    assert rank_by_utility(candidates, robot, base, 4.0, 60.0, 3.0, straight, 0.15) == []


def test_candidate_feasibility_reserves_energy_for_an_uncertain_collect_action():
    candidate = Candidate(Point(2, 0), 1.0, 0.8)
    ranked_without_action = rank_by_utility(
        [candidate], Point(0, 0), Point(0, 0), battery=8.0, battery_initial=60.0,
        reserve=3.0, energy_along=straight, energy_price=0.15,
    )
    ranked_with_action = rank_by_utility(
        [candidate], Point(0, 0), Point(0, 0), battery=8.0, battery_initial=60.0,
        reserve=3.0, energy_along=straight, energy_price=0.15, action_energy=2.0,
    )
    assert ranked_without_action
    assert ranked_with_action == []


def test_collect_goal_reserves_worst_case_action_energy_and_return_route():
    navigation = NavigationService(build_arena(), TerrainEstimator(), SETTINGS)
    position = Point(-1.0, 1.5)
    return_energy = navigation.return_energy(position)
    assert return_energy is not None
    required = return_energy + SETTINGS.false_collect_energy_penalty + SETTINGS.return_reserve
    collect = Subgoal(GoalKind.COLLECT, None, "sample", "test")

    rejected = validate_subgoal(collect, position, required - 0.01, 1.0, navigation, SETTINGS)
    accepted = validate_subgoal(collect, position, required + 0.01, 1.0, navigation, SETTINGS)
    assert not rejected.accepted and "сбор и возврат" in rejected.reason
    assert accepted.accepted


def test_goal_budget_grows_with_localization_uncertainty():
    navigation = NavigationService(build_arena(), TerrainEstimator(), SETTINGS)
    position, target = Point(-1.0, 1.5), Point(0.0, 1.5)
    route = navigation.route(position, target)
    return_energy = navigation.return_energy(target)
    assert route is not None and return_energy is not None
    required_without_localization_margin = (
        route.energy + return_energy + SETTINGS.false_collect_energy_penalty + SETTINGS.return_reserve
    )
    goal = Subgoal(GoalKind.EXPLORE, target, "search", "test")

    reliable = validate_subgoal(
        goal, position, required_without_localization_margin + 0.1, 0.0, navigation, SETTINGS,
    )
    degraded = validate_subgoal(
        goal, position, required_without_localization_margin + 0.1, 0.0, navigation, SETTINGS,
        localization_error_m=0.4, localization_status=LocalizationStatus.DEGRADED,
    )
    assert reliable.accepted
    assert not degraded.accepted and "не хватает энергии" in degraded.reason


def test_energy_price_rises_as_spare_energy_shrinks():
    robot, base = Point(0, 0), Point(0, 0)
    near, far = Candidate(Point(0.5, 0), 1.0, 0.1), Candidate(Point(2.5, 0), 2.0, 0.1)
    full = rank_by_utility([near, far], robot, base, 60.0, 60.0, 3.0, straight, 0.15)
    low = rank_by_utility([near, far], robot, base, 12.0, 60.0, 3.0, straight, 0.15)
    assert full[0].point == far.point and low[0].point == near.point


def test_strong_signal_refines_before_collect_and_collects_at_peak():
    settings = MissionSettings()
    probe = Candidate(Point(0.25, 0), 0.9, 0.9)
    rising = base_context(sample_signal=0.82, best_signal=0.84, refine_candidates=(probe,), at_signal_peak=False)
    assert decide_subgoal(rising, settings).kind is GoalKind.APPROACH
    peak = base_context(sample_signal=0.82, best_signal=0.84, refine_candidates=(probe,), at_signal_peak=True)
    assert decide_subgoal(peak, settings).kind is GoalKind.COLLECT
    exhausted = base_context(sample_signal=0.82, at_signal_peak=True, total_collect_attempts=settings.max_collect_attempts)
    assert decide_subgoal(exhausted, settings).kind is not GoalKind.COLLECT


def test_all_profile_samples_collected_means_return_not_fixed_three():
    settings = settings_for_profile("hard", SETTINGS)
    assert decide_subgoal(base_context(samples_collected=3, target_samples=7), settings).kind is not GoalKind.RETURN
    assert decide_subgoal(base_context(samples_collected=7, target_samples=7), settings).kind is GoalKind.RETURN


def test_peak_detection_and_repeated_targets_are_excluded():
    search = SignalSearch()
    for x, signal in ((0.0, 0.6), (0.2, 0.75), (0.4, 0.85)):
        search.record_signal(Point(x, 0), signal)
    assert search.at_peak(Point(0.4, 0))
    search.record_signal(Point(0.6, 0), 0.7)
    assert not search.at_peak(Point(0.6, 0))
    target = Point(2, 2)
    search.note_target(target)
    search.note_target(target)
    assert search.rank_candidates([target, Point(-2, 2)], Point(0, 0), 0.5, 4.0)[0].point == Point(-2, 2)
    assert all(c.point != target for c in search.rank_candidates([target], Point(0, 0), 0.5, 4.0))


def test_mission_collects_several_samples_and_continues_after_collect():
    clock = FakeClock()
    samples = [Point(-0.9, -0.6), Point(0.4, 1.0), Point(-1.6, 1.6), Point(1.0, -1.7), Point(2.4, 0.3)]
    world = SimWorld(clock, samples, seed=5, rotation_energy_per_rad=0.1)
    controller, mission, journal = make_controller(world, clock, settings=settings_for_profile("medium", SETTINGS))
    run_ticks(controller, world, mission, max_ticks=40000)
    snapshot = mission.snapshot()
    assert snapshot.status is MissionStatus.COMPLETED, snapshot.last_error
    assert snapshot.samples_collected >= 2 and world.battery > 0
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 2000)]
    first = titles.index("Образец собран")
    assert any(title.startswith("Подцель:") for title in titles[first + 1:])  # поиск продолжился после сбора
