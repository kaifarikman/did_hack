import json
from dataclasses import replace

import pytest

from adapters.http.serialization import snapshot_json
from adapters.llm.prompt import build_user_message
from application.run_metrics import HISTORY_LIMIT, RunMetrics
from domain.geometry import Pose
from domain.observations import ObservationFreshness, SourceFreshness
from domain.run_metrics import PlannerMetrics
from domain.subgoals import PlanningContext
from harness import make_mission


def frame(moment, sequence, position=0.0, **fields):
    return replace(make_mission().snapshot(), simulation_time_s=moment, observation_sequence=sequence,
                   robot_pose=Pose(position, 0, 0), battery_remaining=50, return_energy_estimate=8, **fields)


def test_one_summary_drives_http_and_planner_without_history():
    accumulator = RunMetrics(3, 1)
    accumulator.observe(frame(0, 1), 10, False, PlannerMetrics())
    view = accumulator.observe(frame(1, 2, 0.1), 12, False, PlannerMetrics(2, 1, 1, 4))
    assert view.summary.distance_m == pytest.approx(0.1)
    assert view.summary.available_energy == 39
    assert view.summary.real_time_factor == 0.5
    context = PlanningContext('run-1', Pose(0, 0, 0), make_mission().snapshot().base_position,
                              50, 60, None, None, 0, 8, False, 0, 0, 0, 0, metrics=view.summary)
    prompt = json.loads(build_user_message(context))['run_metrics']
    payload = json.loads(json.dumps(snapshot_json(replace(frame(1, 2), analytics=view))))['analytics']
    assert prompt == payload['summary']
    assert 'history' not in prompt


def test_duplicates_wrong_robot_generation_and_time_reversal_are_ignored():
    accumulator = RunMetrics(3, 1)
    initial = accumulator.observe(frame(2, 2), 2, False, PlannerMetrics())
    for invalid in (frame(3, 2, .1), frame(3, 1, .1), frame(1, 3), frame(3, 3, generation=2),
                    frame(3, 3, robot_id='robot_2')):
        assert accumulator.observe(invalid, 3, False, PlannerMetrics()) is initial
    assert initial.summary.distance_m == 0


def test_gaps_and_pose_jumps_never_become_speed_or_distance():
    accumulator = RunMetrics(3, .5)
    accumulator.observe(frame(0, 1), 0, False, PlannerMetrics())
    gap = accumulator.observe(frame(5, 2, .1), 5, False, PlannerMetrics())
    assert gap.summary.speed_mps is None
    assert gap.history[-1].continuous is False
    jump = accumulator.observe(frame(6, 3, 5), 6, False, PlannerMetrics())
    assert jump.summary.distance_m == 0
    assert dict(jump.summary.phase_seconds)['unknown'] == 6


def test_history_is_bounded_and_first_sample_does_not_invent_speed():
    accumulator = RunMetrics(3, 1)
    first = accumulator.observe(frame(0, 1), 0, False, PlannerMetrics())
    assert first.summary.speed_mps is None
    for sequence in range(2, HISTORY_LIMIT + 20):
        view = accumulator.observe(frame(sequence - 1, sequence, sequence * .01), sequence - 1, False, PlannerMetrics())
    assert len(view.history) == HISTORY_LIMIT
    assert view.history[0].simulation_time_s > 0
    assert view.summary.distance_m > 1


def test_stale_sources_and_unknown_return_stay_unknown():
    accumulator = RunMetrics(3, 1)
    accumulator.observe(frame(0, 1), 0, False, PlannerMetrics())
    stale = replace(frame(1, 2, .1, freshness=ObservationFreshness(odom=SourceFreshness(5, False))), return_energy_estimate=None)
    view = accumulator.observe(stale, 1, False, PlannerMetrics())
    assert view.summary.speed_mps is None
    assert view.summary.available_energy is None
    assert not view.history[-1].continuous


def test_phases_are_mutually_exclusive_and_use_simulation_time():
    accumulator = RunMetrics(3, 1)
    accumulator.observe(frame(0, 1), 0, False, PlannerMetrics())
    accumulator.observe(frame(1, 2, .1), 1, True, PlannerMetrics())
    view = accumulator.observe(frame(2, 3, .1), 2, True, PlannerMetrics())
    assert dict(view.summary.phase_seconds)['moving'] == 1
    assert dict(view.summary.phase_seconds)['planning'] == 1
    assert sum(dict(view.summary.phase_seconds).values()) == 2


def test_recovery_does_not_bridge_a_stale_pose():
    accumulator = RunMetrics(3, 1)
    accumulator.observe(frame(0, 1), 0, False, PlannerMetrics())
    accumulator.observe(frame(1, 2, .2, freshness=ObservationFreshness(odom=SourceFreshness(5, False))), 1, False, PlannerMetrics())
    recovered = accumulator.observe(frame(2, 3, .4), 2, False, PlannerMetrics())
    assert recovered.summary.speed_mps is None
    assert recovered.summary.distance_m == 0
    assert not recovered.history[-1].continuous


def test_controller_exposes_metrics_and_bounded_planner_context():
    from fakes import FakeClock, ScriptedPlanner, SimWorld
    from harness import make_controller
    from domain.geometry import Point
    from domain.subgoals import GoalKind, Subgoal
    clock = FakeClock()
    world = SimWorld(clock, [Point(3, 2.5)])
    planner = ScriptedPlanner([Subgoal(GoalKind.EXPLORE, Point(-1, -.5), 'probe', 'llm')])
    controller, mission, _ = make_controller(world, clock, planner=planner)
    for _ in range(20):
        world.advance()
        controller.tick()
    assert mission.snapshot().analytics.summary.run_id == mission.run_id
    assert planner.contexts[0].metrics is not None
    assert planner.contexts[0].metrics.robot_id == mission.robot_id
    assert not hasattr(planner.contexts[0].metrics, 'history')
    assert mission.snapshot().analytics.summary.planner.requests == 1
