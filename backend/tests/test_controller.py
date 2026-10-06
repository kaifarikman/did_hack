import pytest

from application.planner import FallbackPlanner, ResilientPlanner
from domain.geometry import Point, Pose
from domain.mission import MissionStatus
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, Subgoal
from fakes import (
    FailingResetSimulation, FakeClock, ScriptedPlanner, SimWorld, Zone, planner_error,
)
from harness import SETTINGS, make_controller, make_mission, run_ticks

SEED_SAMPLES = {
    1: [Point(1.5, 1.0), Point(-1.0, 2.0), Point(2.5, -1.5)],
    2: [Point(-2.5, 1.5), Point(1.0, -2.0), Point(2.8, 1.8)],
    3: [Point(0.5, -1.0), Point(-3.0, -2.0), Point(2.0, 2.2)],
}


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_autonomous_search_collect_and_return_over_several_seeds(seed):
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[seed], seed=seed)
    controller, mission, journal = make_controller(world, clock)
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    assert snapshot.status is MissionStatus.COMPLETED, snapshot.last_error
    assert snapshot.samples_collected >= 1 and world.collected == snapshot.samples_collected
    assert snapshot.battery_remaining > 0 and world.finished
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 500)]
    assert "Образец собран" in titles and "Миссия завершена" in titles
    assert world.reset_calls == 1
    assert world.linear == 0 and world.angular == 0


def test_stop_during_motion_stops_robot_and_is_not_success():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock)
    for _ in range(80):
        world.advance()
        controller.tick()
    assert world.linear > 0 or world.angular != 0
    mission.request_stop()
    world.advance()
    controller.tick()
    assert mission.status is MissionStatus.STOPPED
    assert world.linear == 0 and world.angular == 0
    controller.tick()  # терминальное состояние стабильно
    assert mission.status is MissionStatus.STOPPED


def test_stale_observations_stop_motion_and_fail_independent_of_planner():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock)
    for _ in range(60):
        world.advance()
        controller.tick()
    assert world.linear != 0 or world.angular != 0
    world.frozen = True  # датчик перестал обновляться
    for _ in range(15):
        world.advance()
        controller.tick()
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "observations_stale"
    assert world.linear == 0 and world.angular == 0


def test_recovery_of_sensor_does_not_resume_cancelled_motion():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock)
    for _ in range(60):
        world.advance()
        controller.tick()
    world.frozen = True
    for _ in range(15):
        world.advance()
        controller.tick()
    world.frozen = False
    for _ in range(20):
        world.advance()
        controller.tick()
    assert mission.status is MissionStatus.FAILED and world.linear == 0


def test_battery_depletion_fails_without_success():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1], battery=0.0)
    controller, mission, _ = make_controller(world, clock)
    run_ticks(controller, world, mission, 50)
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "battery_depleted"


def test_reset_failure_fails_run_with_stopped_robot():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock, simulation=FailingResetSimulation())
    controller.tick()
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "reset_failed" and world.stop_calls >= 1


def test_stop_while_starting_never_starts_motion():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock)
    mission.request_stop()
    controller.tick()
    assert mission.status is MissionStatus.STOPPED and world.linear == 0


def test_observation_from_previous_run_is_ignored_until_fresh_one_arrives():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    world.frozen = True
    controller, mission, _ = make_controller(world, clock)
    controller.tick()  # reset выполнен, наблюдение старше момента сброса
    clock.now_s += 0.5
    world.last_received_s = clock.now_s - 10  # старое наблюдение предыдущего прогона
    controller.tick()
    assert mission.status is MissionStatus.RUNNING and mission.snapshot().robot_pose is None
    world.frozen = False
    world.advance()
    controller.tick()
    assert mission.snapshot().robot_pose is not None


def test_stale_planner_answer_after_stop_is_ignored():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    mission = make_mission()
    goal = Subgoal(GoalKind.EXPLORE, Point(0.0, -2.0), "x", "llm")
    planner = ScriptedPlanner([goal], on_call=lambda: mission.request_stop())
    controller, mission, journal = make_controller(
        world, clock, mission=mission, planner=ResilientPlanner(planner, FallbackPlanner(SETTINGS))
    )
    for _ in range(3):
        world.advance()
        controller.tick()
    assert mission.status is MissionStatus.STOPPED
    assert world.linear == 0 and mission.snapshot().current_goal is None


def test_planner_failure_uses_visible_fallback_and_mission_continues():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    resilient = ResilientPlanner(ScriptedPlanner([planner_error("таймаут")] * 500), FallbackPlanner(SETTINGS))
    controller, mission, _ = make_controller(world, clock, planner=resilient)
    for _ in range(5):
        world.advance()
        controller.tick()
    snapshot = mission.snapshot()
    assert snapshot.current_goal is not None and snapshot.current_goal.source == "fallback"
    assert "таймаут" in snapshot.current_goal.reason and snapshot.planner_mode == "fallback"


def test_invalid_llm_goal_is_rejected_and_logged_then_alternative_used():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    bad = Subgoal(GoalKind.EXPLORE, Point(0.05, 0.55), "в столб", "llm")  # внутри столба
    planner = ScriptedPlanner([bad])
    controller, mission, journal = make_controller(
        world, clock, planner=ResilientPlanner(planner, FallbackPlanner(SETTINGS))
    )
    for _ in range(4):
        world.advance()
        controller.tick()
    titles = [e.draft.title for e in journal.tail(mission.run_id, 50)]
    assert "Подцель отклонена исполнителем" in titles
    assert mission.snapshot().current_goal is not None and mission.snapshot().current_goal.target != bad.target


def test_goal_without_energy_margin_is_rejected():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1], battery=8.0)
    far = Subgoal(GoalKind.EXPLORE, Point(3.0, 2.0), "далеко", "llm")
    controller, mission, journal = make_controller(
        world, clock, planner=ResilientPlanner(ScriptedPlanner([far]), FallbackPlanner(SETTINGS))
    )
    for _ in range(4):
        world.advance()
        controller.tick()
    details = " ".join(e.draft.detail for e in journal.tail(mission.run_id, 50))
    assert "не хватает энергии" in details


@pytest.mark.parametrize("attempt_limit", [1, 4])
def test_failed_collect_is_logged_and_attempts_are_bounded(attempt_limit):
    from dataclasses import replace
    import time

    class MisleadingSignalWorld(SimWorld):
        collect_calls = 0

        def latest(self):
            return replace(super().latest(), sample_signal=1.0)

        def collect(self):
            self.collect_calls += 1
            return super().collect()

    clock = FakeClock()
    world = MisleadingSignalWorld(clock, [Point(3.0, 2.5)])
    collect = Subgoal(GoalKind.COLLECT, None, "проверка", "llm")
    controller, mission, journal = make_controller(
        world, clock, planner=ScriptedPlanner([collect] * 30),
        settings=MissionSettings(max_collect_attempts=attempt_limit),
    )
    # LLM настаивает на сборе; исполнитель ограничивает общий и локальный лимиты.
    for _ in range(200):
        world.advance()
        controller.tick()
        time.sleep(0.001)  # дать фоновому планировщику завершить ответ
        if any(entry.draft.title == "Подцель отклонена исполнителем"
               for entry in journal.tail(mission.run_id, 50)):
            break
    titles = [e.draft.title for e in journal.tail(mission.run_id, 50)]
    assert world.collect_calls == min(attempt_limit, 2)
    assert titles.count("Сбор не удался") == world.collect_calls
    assert "Подцель отклонена исполнителем" in titles
    assert mission.samples_collected == 0


def test_weak_signal_collect_from_llm_is_rejected_before_calling_judge():
    import time

    clock = FakeClock()
    world = SimWorld(clock, [Point(3.0, 2.5)], signal_noise=0)
    collect = Subgoal(GoalKind.COLLECT, None, "собрать несмотря на слабый сигнал", "llm")
    controller, mission, journal = make_controller(world, clock, planner=ScriptedPlanner([collect]))
    for _ in range(8):
        world.advance()
        controller.tick()
        time.sleep(0.001)
    titles = [entry.draft.title for entry in journal.tail(mission.run_id, 50)]
    assert "Подцель отклонена исполнителем" in titles
    assert "Сбор не удался" not in titles and "Образец собран" not in titles


def test_low_reserve_returns_before_asking_llm_at_rest():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1], battery=2.0)
    planner = ScriptedPlanner([Subgoal(GoalKind.COLLECT, None, "собрать", "llm")])
    controller, mission, _ = make_controller(world, clock, planner=planner)
    controller.tick()  # reset
    world.advance()
    controller.tick()
    assert planner.calls == 0
    assert mission.status is MissionStatus.RETURNING
    assert mission.snapshot().current_goal.kind is GoalKind.RETURN


def test_reserve_overrides_goal_and_robot_returns_with_positive_battery():
    clock = FakeClock()
    world = SimWorld(clock, [Point(3.0, 2.5)], battery=22.0)
    controller, mission, journal = make_controller(world, clock)
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    # образец недостижим по энергии: прогон не может быть успешным, но возврат на базу происходит
    assert snapshot.status is MissionStatus.FAILED and snapshot.last_error.code == "no_confirmed_sample"
    assert snapshot.battery_remaining > 0
    assert world.finished and Point(*[world.pose.x_m, world.pose.y_m]) is not None


def test_finish_rejected_by_judge_is_not_success():
    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])

    class RejectingJudge:
        def collect(self):
            return world.collect()

        def finish(self):
            from application.ports import JudgeReply
            return JudgeReply(False, "не на базе")

    controller, mission, _ = make_controller(world, clock, judge=RejectingJudge())
    run_ticks(controller, world, mission)
    assert mission.status is MissionStatus.FAILED
    assert mission.snapshot().last_error.code == "finish_rejected"


def test_terrain_cost_experiment_links_hypothesis_measurement_and_conclusion():
    clock = FakeClock()
    zone = Zone(Point(0.0, -1.8), 0.7, 4.0)
    world = SimWorld(clock, [Point(3.0, 2.5)], zones=[zone], battery=200.0)
    settings = MissionSettings(max_decisions=40, battery_initial=200.0)
    controller, mission, journal = make_controller(world, clock, settings=settings)
    run_ticks(controller, world, mission, 40000)
    entries = journal.tail(mission.run_id, 1000)
    by_hypothesis = {}
    for entry in entries:
        if entry.draft.hypothesis_id:
            by_hypothesis.setdefault(entry.draft.hypothesis_id, []).append(entry.draft)
    assert by_hypothesis, "ожидалась хотя бы одна гипотеза о грунте"
    linked = [
        drafts for drafts in by_hypothesis.values()
        if {d.kind.value for d in drafts} >= {"hypothesis", "experiment", "outcome"}
    ]
    assert linked, f"нет цикла гипотеза→эксперимент→итог: {by_hypothesis}"
    outcome = next(d for d in linked[0] if d.kind.value == "outcome")
    assert outcome.observed is None or "ед./м" in outcome.observed
    # неподтверждённая гипотеза не получает вывода
    for drafts in by_hypothesis.values():
        for draft in drafts:
            if draft.kind.value in ("hypothesis", "experiment"):
                assert draft.conclusion is None
    # оценка грунта отражена в снимке
    assert mission.snapshot().terrain_estimates


def test_slow_planner_does_not_block_ticks_and_stop_is_prompt():
    import threading
    import time

    release = threading.Event()

    class HangingPlanner:
        def propose(self, context, is_cancelled):
            release.wait(5.0)
            raise planner_error("завис")

    clock = FakeClock()
    world = SimWorld(clock, SEED_SAMPLES[1])
    controller, mission, _ = make_controller(world, clock, planner=HangingPlanner())
    for _ in range(5):
        world.advance(0.1)
        controller.tick()
    started = time.monotonic()
    mission.request_stop()
    controller.tick()
    release.set()
    assert time.monotonic() - started < 1.0
    assert mission.snapshot().status is MissionStatus.STOPPED
