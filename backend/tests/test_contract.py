"""Контракт F02: общие fixtures, reset с поколением, события, неизвестный исход судьи, локализация."""
import pytest

from adapters.legacy_reset import LegacySimulationControl, UnsupportedReset
from application.event_feed import EventFeed
from application.ports import JudgeReply, MapMode, OperationOutcome, PublicScore, ResetRequest
from domain.events import EventKind, PublicEvent
from domain.geometry import Point
from domain.grid import FREE, UNKNOWN
from domain.mission import MissionStatus
from domain.observations import LocalizationStatus
from contract_fixtures import (
    assert_observation_valid, load_events, load_judge, load_map, load_observation, load_reset,
)
from fakes import FakeClock, SimWorld, TimeoutJudge
from harness import make_controller, run_ticks

SAMPLES = [Point(1.5, 1.0), Point(-1.0, 2.0), Point(2.5, -1.5)]


@pytest.mark.parametrize("name", [
    "observation-ok.json", "observation-no-signal.json", "observation-localization-lost.json",
    "observation-robot2.json",
])
def test_observation_fixtures_satisfy_adapter_invariants(name):
    observation = load_observation(name)
    assert_observation_valid(observation)
    assert observation.generation == 3


def test_missing_signal_differs_from_lost_localization():
    no_signal = load_observation("observation-no-signal.json")
    lost = load_observation("observation-localization-lost.json")
    assert no_signal.sample_signal is None and not no_signal.motion_critical_missing
    assert lost.localization is LocalizationStatus.LOST and lost.motion_critical_missing


def test_reset_ack_must_confirm_same_generation():
    request, ack, stale = load_reset()
    assert ack.matches(request)
    assert not stale.matches(request)


def test_run_service_resumes_generation_after_backend_restart():
    from application.run_service import RunService
    from adapters.journal.memory import InMemoryJournal
    from fakes import FakeEnvironment, StaticMap
    from harness import SETTINGS, make_controller

    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    environment, maps, journal = FakeEnvironment(), StaticMap(), InMemoryJournal()

    def factory(mission, _link=None):
        controller, _, _ = make_controller(world, clock, journal=journal, mission=mission)
        return controller

    resumed_service = RunService(environment, maps, journal, factory, SETTINGS, initial_generation=41)
    for index in range(2):
        run = resumed_service.start_run(f"restart-{index}", "easy", 1)
        assert run.run_id is not None
        resumed_service.tick()
        if index == 0:
            resumed_service.stop_run(f"stop-{index}", run.run_id)
            resumed_service.tick()
    assert resumed_service._current.missions[0].generation == 43


def test_judge_reply_outcomes_and_legacy_derivation():
    replies, score = load_judge()
    assert replies["unknown"].outcome is OperationOutcome.UNKNOWN and not replies["unknown"].success
    assert JudgeReply(True).outcome is OperationOutcome.SUCCEEDED
    assert JudgeReply(False, "x").outcome is OperationOutcome.REJECTED
    with pytest.raises(ValueError):
        JudgeReply(False, "", OperationOutcome.SUCCEEDED)
    assert score.collected == 2 and score.finish_success is None


def test_ros_payload_parsers_expose_typed_events_and_public_score_without_hidden_fields():
    import json

    from adapters.ros.judge_messages import parse_public_event, parse_public_score

    event = parse_public_event(json.dumps({
        "type": "sample_collected", "sequence": 1, "robot_id": "robot_1",
        "simulation_time_s": 4.5, "battery": 22.0, "generation": 3,
        "position": [0.25, -0.5], "sample_position": [1, 2],
    }), sequence=1)
    assert event == PublicEvent(1, EventKind.SAMPLE_COLLECTED, 4.5, "robot_1", 3, Point(0.25, -0.5), 22.0)
    assert parse_public_event('{"type":"collision","sequence":0}', 2) is None
    assert parse_public_event('{"type":"collision","sequence":true}', 2) is None
    assert parse_public_event('{"type":"collision","sequence":2,"battery":NaN}', 2) is None
    assert parse_public_event('{"type":"collision","generation":true}', 2) is None
    assert parse_public_event('{"type":"collision","position":[1,Infinity]}', 2) is None
    assert parse_public_event('{"type":"secret_schedule","sample_position":[1,2]}', 2) is None
    assert parse_public_score('{"collected":2,"finished":true,"finish_success":true,'
                              '"simulation_time_s":12.0}') == PublicScore(2, True, True, 12.0)
    assert parse_public_score('{"collected":"2","finished":true}') is None
    assert parse_public_score('{"collected":true,"finished":false}') is None
    assert parse_public_score('{"collected":1,"finished":false,"simulation_time_s":Infinity}') is None
    assert parse_public_score('{"collected":1,"finished":false,"generation":true}') is None
    assert parse_public_score('{"collected":1,"finished":false,"robot_id":2}') is None


def test_public_telemetry_requires_current_generation_and_finite_measurements():
    from adapters.ros.judge_messages import parse_public_telemetry

    valid = parse_public_telemetry(
        '{"generation":4,"simulation_time_s":12.5,"robot_id":"robot_1",'
        '"battery":39.5,"signal":0.4}'
    )
    assert valid is not None
    assert (valid.generation, valid.simulation_time_s, valid.battery, valid.signal) == (4, 12.5, 39.5, 0.4)
    assert parse_public_telemetry(
        '{"generation":true,"simulation_time_s":12.5,"battery":39.5,"signal":0.4}'
    ) is None
    assert parse_public_telemetry(
        '{"generation":4,"simulation_time_s":12.5,"battery":39.5,"signal":NaN}'
    ) is None


def test_slam_map_fixture_keeps_unknown_cells_and_revision():
    grid = load_map()
    assert grid.revision == 5 and grid.frame_id == "world"
    assert UNKNOWN in grid.cells and FREE in grid.cells


class _ListEvents:
    def __init__(self, events):
        self.events = events

    def events_after(self, sequence):
        return [event for event in self.events if event.sequence > sequence] + [
            event for event in self.events if event.sequence <= sequence
        ]


def test_event_feed_drops_duplicates_other_generation_and_other_robot():
    events = load_events()
    feed = EventFeed(_ListEvents(events), generation=3, robot_id="robot_1")
    kinds = [event.kind for event in feed.poll()]
    assert kinds == [EventKind.COLLISION, EventKind.HAZARD_HIT, EventKind.SAMPLE_COLLECTED]
    assert feed.poll() == []
    assert EventFeed(_ListEvents(events), generation=4, robot_id="robot_1").poll() == []
    assert EventFeed(_ListEvents(events), generation=3, robot_id="robot_2").poll() == []


class _SeedOnly:
    def __init__(self):
        self.calls = []

    def reset(self, scenario, seed):
        self.calls.append((scenario, seed))


def test_legacy_reset_supports_all_public_profiles_and_rejects_unconnected_modes():
    legacy = _SeedOnly()
    control = LegacySimulationControl(legacy)
    request = ResetRequest("easy", 5, generation=2)
    assert control.reset(request).matches(request) and legacy.calls == [("easy", 5)]
    for scenario, seed in (("medium", 8), ("hard", 9)):
        request = ResetRequest(scenario, seed, generation=seed)
        assert control.reset(request).matches(request)
    for unsupported in (ResetRequest("extreme", 5, 3), ResetRequest("easy", 5, 4, MapMode.SLAM),
                        ResetRequest("easy", 5, 5, robot_ids=("robot_1", "robot_2"))):
        with pytest.raises(UnsupportedReset):
            control.reset(unsupported)
    assert legacy.calls == [("easy", 5), ("medium", 8), ("hard", 9)]


def test_controller_sends_generation_and_fails_on_mismatched_ack():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)

    class WrongAck:
        def reset(self, request):
            ack = world.reset(request)
            return type(ack)(ack.generation - 1, ack.scenario, ack.seed)

    controller, mission, _ = make_controller(world, clock, simulation=WrongAck())
    world.advance()
    controller.tick()
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "reset_mismatch"
    assert world.linear == 0


def test_observation_of_other_generation_is_ignored():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    controller, mission, _ = make_controller(world, clock)
    world.advance()
    controller.tick()
    assert world.last_reset.generation == mission.generation
    world.generation = mission.generation + 7  # поздние данные чужого поколения
    for _ in range(20):
        world.advance()
        controller.tick()
    assert world.linear == 0 and mission.snapshot().robot_pose is None
    world.generation = mission.generation
    for _ in range(5):
        world.advance()
        controller.tick()
    assert mission.snapshot().robot_pose is not None


def test_unknown_collect_is_reconciled_with_public_score_without_double_count():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    judge = TimeoutJudge(world)
    controller, mission, journal = make_controller(world, clock, judge=judge, score=world, events=world)
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    assert world.collected >= 1
    assert snapshot.samples_collected == world.collected  # ни одного лишнего или пропущенного
    # finish тоже без ответа, но счёт подтверждает успех
    assert snapshot.status is MissionStatus.COMPLETED, snapshot.last_error
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 1000)]
    assert "Исход finish сверен со счётом" in titles


def test_unknown_collect_without_score_is_not_counted():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    controller, mission, journal = make_controller(world, clock, judge=TimeoutJudge(world))
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    assert snapshot.samples_collected == 0 and snapshot.status is not MissionStatus.COMPLETED
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 1000)]
    assert "Исход сбора неизвестен" in titles


def test_unknown_judge_operation_ignores_score_from_another_generation():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    judge = TimeoutJudge(world)

    class StaleScore:
        def score(self):
            from application.ports import PublicScore
            return PublicScore(world.collected, world.finished, world.finish_success,
                               clock.now_s, generation=world.generation + 1)

    controller, mission, _ = make_controller(world, clock, judge=judge, score=StaleScore(), events=world)
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    assert world.collected >= 1
    assert snapshot.samples_collected == 0
    assert snapshot.status is not MissionStatus.COMPLETED


def test_unknown_finish_without_public_score_is_not_reported_as_success():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)

    class LostFinishReply:
        finish_calls = 0

        def collect(self):
            return world.collect()

        def finish(self):
            self.finish_calls += 1
            world.finish()
            return JudgeReply(False, "ответ finish потерян", OperationOutcome.UNKNOWN)

    judge = LostFinishReply()
    controller, mission, _ = make_controller(world, clock, judge=judge)
    run_ticks(controller, world, mission)
    assert world.collected >= 1 and world.finished
    assert judge.finish_calls == 1
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "finish_rejected"


def test_lost_localization_stops_motion_then_fails_if_not_recovered():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    controller, mission, journal = make_controller(world, clock)
    for _ in range(60):
        world.advance()
        controller.tick()
    world.localization = LocalizationStatus.LOST
    world.advance()
    controller.tick()
    assert world.linear == 0 and world.angular == 0
    assert mission.status is MissionStatus.RUNNING
    for _ in range(80):
        world.advance()
        controller.tick()
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "localization_lost"


def test_penalty_events_are_logged_once_from_event_source():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    controller, mission, journal = make_controller(world, clock, events=world)
    for _ in range(30):
        world.advance()
        controller.tick()
    world.emit(EventKind.HAZARD_HIT)
    for _ in range(10):
        world.advance()
        controller.tick()
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 500)]
    assert titles.count("Событие судьи: hazard_hit") == 1
