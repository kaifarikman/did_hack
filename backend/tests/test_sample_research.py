from dataclasses import replace

import pytest

from adapters.http.serialization import snapshot_json
from application.sample_research import SampleResearch
from domain.geometry import Point, Pose
from domain.observations import Observation
from domain.sample_hypotheses import SampleHypothesis
from domain.search import SignalSearch
from domain.subgoals import GoalKind, Subgoal
from fakes import FakeClock, SimWorld
from harness import make_controller


def frame(moment=1., sequence=1, position=0., signal=.4, **fields):
    return Observation(moment, Pose(position, 0, 0), 60., signal, moment,
                       sequence=sequence, generation=1, sample_signal_age_s=0.,
                       sample_signal_received_monotonic_s=moment, **fields)


def hypothesis():
    return SampleHypothesis('sample-hypothesis-1', Point(1, 0), .4, .4, frame(), 1., 1.)


@pytest.mark.parametrize('signal,status', [(.42, 'confirmed'), (.8, 'refuted'), (.50, 'unverified')])
def test_preregistered_forecast_uses_only_new_independent_measurements(signal, status):
    item = hypothesis()
    for sequence in range(2, 5):
        item.observe(frame(float(sequence), sequence, .9, signal), True, float(sequence))
    item.finish()
    assert item.status == status
    assert item.expected_signal == .4
    assert item.measured_signal == signal
    assert all(moment > item.start.simulation_time_s and sequence > item.start.sequence
               for moment, _, sequence in item.measurements)


def test_duplicates_stale_wrong_identity_and_pre_action_samples_do_not_confirm():
    item = hypothesis()
    valid = frame(2, 2, .9)
    item.observe(valid, True, 2.)
    for observation in (valid, replace(valid, generation=2), replace(valid, robot_id='robot_2'),
                        replace(valid, simulation_time_s=3, sequence=3, sample_signal_age_s=1.),
                        replace(valid, simulation_time_s=1.1, sequence=3, sample_signal_age_s=.2),
                        replace(valid, sample_signal=None), replace(valid, sequence=1)):
        item.observe(observation, True, observation.simulation_time_s)
    item.finish()
    assert item.status == 'unverified' and item.measured_signal is None
    assert len(item.measurements) == 1


def test_interrupted_experiment_never_confirms_even_with_enough_measurements():
    item = hypothesis()
    for sequence in range(2, 5):
        item.observe(frame(float(sequence), sequence, .9), True, float(sequence))
    item.finish('observations_stale')
    assert item.status == 'unverified' and item.measured_signal is None


def test_bounded_book_preserves_unique_ids_and_signal_units():
    research = SampleResearch()
    goal = Subgoal(GoalKind.EXPLORE, Point(1, 0), 'test')
    for index in range(40):
        item, notes = research.start(frame(), goal, .4, True, 1.)
        assert notes[0].expected and notes[1].experiment_id
        research.finish(2., 'interrupted')
    assert len(research.items) == 32
    assert research.items[-1].hypothesis_id == 'sample-hypothesis-40'
    view = research.views()[-1]
    assert view.kind == 'sample_signal' and view.expected_energy_per_m is None
    assert view.expected_signal == .4


def test_independent_measurement_replaces_local_prior_not_duplicates_it():
    search = SignalSearch()
    search.record_signal(Point(1, 0), .9)
    search.assimilate_measurement(Point(1, 0), .2)
    assert search.predicted_signal(Point(1, 0)) == pytest.approx(.2)
    assert search.best_signal == .2
    assert search.recent_signals() == ((Point(1, 0), .2),)


@pytest.mark.parametrize('source', ['llm', 'fallback'])
def test_controller_full_science_chain_updates_search_and_replans(source):
    clock = FakeClock()
    world = SimWorld(clock, [Point(1.5, 1)])
    controller, mission, journal = make_controller(world, clock)
    controller.tick()  # reset
    clock.now_s = 1.
    start = frame()
    controller._search.record_signal(start.pose.point, .4)
    controller._apply_goal(start, Subgoal(GoalKind.EXPLORE, Point(1, 0), 'test', source=source))
    identifier = mission.snapshot().research.active_hypothesis_id
    assert identifier is not None
    for sequence in range(2, 5):
        controller._sample_research.observe(frame(float(sequence), sequence, .9, .8), True, float(sequence))
    clock.now_s = 5.
    controller._on_arrival(frame(5., 5, .9, .8))
    assert mission.snapshot().research.active_hypothesis_id is None
    view = mission.snapshot().research.hypotheses[-1]
    assert view.status == 'refuted' and view.measured_signal == .8
    assert controller._search.predicted_signal(Point(1, 0)) > .7
    entries = [entry for entry in journal.tail(mission.run_id, 100) if entry.draft.hypothesis_id == identifier]
    assert entries[0].draft.kind.value == 'hypothesis'
    assert entries[1].draft.kind.value == 'experiment'
    assert entries[-1].draft.title == 'Вывод учтён в решении'
    assert entries[-2].draft.evidence == tuple(f'sample-time-{sequence:.6f}-observation-{sequence}' for sequence in range(2, 5))
    payload = snapshot_json(mission.snapshot())['research']['hypotheses'][-1]
    assert payload['expected_energy_per_m'] is None and payload['measured_signal'] == .8


def test_controller_stop_publishes_inconclusive_sample_hypothesis():
    clock = FakeClock()
    controller, mission, _ = make_controller(SimWorld(clock, []), clock)
    controller.tick()
    clock.now_s = 1.
    controller._apply_goal(frame(), Subgoal(GoalKind.EXPLORE, Point(1, 0), 'test'))
    mission.request_stop()
    controller.tick()
    assert mission.snapshot().research.hypotheses[-1].status == 'unverified'
    assert mission.snapshot().research.active_hypothesis_id is None


def test_science_checker_rejects_reused_measurement_or_missing_experiment():
    import importlib.util
    from pathlib import Path
    checker_path = Path(__file__).resolve().parents[2] / '.agents/skills/research-run/scripts/check_science_chain.py'
    spec = importlib.util.spec_from_file_location('science_checker', checker_path)
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    identifier = 'sample-hypothesis-1'
    entries = [
        dict(sequence=1, kind='hypothesis', title='forecast', hypothesis_id=identifier,
             expected='0.4', simulation_time_s=1., evidence=['observation-1', 'prediction-monotonic-1.0']),
        dict(sequence=2, kind='experiment', title='any title', hypothesis_id=identifier, experiment_id='exp-1'),
        dict(sequence=3, kind='outcome', title='conclusion', hypothesis_id=identifier,
             conclusion='Подтверждён', observed='0.4', evidence=[
                 f'sample-time-{sequence:.6f}-observation-{sequence}' for sequence in range(2, 5)]),
        dict(sequence=4, kind='decision', title='Вывод учтён в решении', hypothesis_id=identifier),
    ]
    assert checker.check(entries)[1] == []
    assert any('эксперимента' in defect for defect in checker.check([entries[0], *entries[2:]])[1])
    entries[2]['evidence'] = ['sample-time-1.000000-observation-1'] * 3
    assert any('независимых' in defect for defect in checker.check(entries)[1])


def test_single_robot_tick_accumulates_samples_and_completes_real_route():
    class TimestampedWorld(SimWorld):
        def latest(self):
            return replace(super().latest(), sample_signal_age_s=0., sequence=round(self.clock.now_s * 10),
                           sample_signal_received_monotonic_s=self.clock.now_s)

    clock = FakeClock()
    world = TimestampedWorld(clock, [Point(1.5, 1.0)])
    controller, mission, journal = make_controller(world, clock)
    assert controller._ports.coordination is None
    for _ in range(1200):
        world.advance(.1)
        controller.tick()
        completed = [item for item in controller._sample_research.items if item.status in ('confirmed', 'refuted')]
        if completed or mission.status.is_terminal:
            break
    assert completed, [(item.status, len(item.measurements)) for item in controller._sample_research.items]
    item = completed[0]
    assert len(item.measurements) >= 3
    assert item.measured_signal is not None
    assert any(entry.draft.title == 'Вывод учтён в решении' and entry.draft.hypothesis_id == item.hypothesis_id
               for entry in journal.tail(mission.run_id, 100))


def test_sample_identity_uses_wall_clock_even_when_simulation_runs_faster():
    item = hypothesis()
    # The same sensor packet was received at wall=2; sim clock runs at a different rate.
    first = replace(frame(100, 2, .9), sample_signal_age_s=.1, sample_signal_received_monotonic_s=2.)
    duplicate = replace(frame(101, 3, .9), sample_signal_age_s=.2, sample_signal_received_monotonic_s=2.)
    item.observe(first, True, 2.1)
    item.observe(duplicate, True, 2.2009)  # controller clock read has jitter relative to the bridge
    assert len(item.measurements) == 1
