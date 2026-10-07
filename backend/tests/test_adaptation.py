"""Научный цикл и адаптация: обнаружение изменений грунта, опасности, неисправность датчика."""
import random

import pytest

from domain.change_detection import TerrainChangeDetector
from domain.energy import TerrainEstimator, TravelSegment
from domain.events import EventKind
from domain.geometry import Point
from domain.hazards import HazardMap
from domain.hypotheses import HypothesisBook, HypothesisKind, HypothesisStatus
from domain.mission import MissionStatus
from domain.sensor_health import SensorFault, SensorHealthMonitor, SensorState
from domain.subgoals import GoalKind, Subgoal
from fakes import FakeClock, ScriptedPlanner, SimWorld, WorldChange, Zone
from harness import SETTINGS, make_controller, run_ticks


def cell_pass(cost, rng, noise=0.01, rotation=0.0):
    length = 0.4
    drop = length * cost + 0.1 * rotation + rng.gauss(0, noise)
    return TravelSegment(Point(0.05, 0.25), Point(0.45, 0.25), length, drop, 3.0, rotation)


def other_cell(rng):
    return TravelSegment(Point(1.05, 0.25), Point(1.45, 0.25), 0.4, 0.4 + rng.gauss(0, 0.01), 3.0)


def feed(estimator, detector, segment):
    pieces, predicted = estimator.prediction_for(segment)
    before = estimator.estimate_for_bucket(max(pieces, key=lambda p: p[1])[0])
    std = estimator.residual_std
    record = estimator.record(segment)
    return detector.update(record, predicted, std, before)


@pytest.mark.parametrize("new_cost, rising", [(3.0, True), (0.4, False)])
def test_detector_finds_rise_and_fall_after_established_level(new_cost, rising):
    rng = random.Random(1)
    estimator, detector = TerrainEstimator(prior_energy_per_m=1.5), TerrainChangeDetector()
    for _ in range(8):
        assert feed(estimator, detector, cell_pass(1.0, rng)) is None
        feed(estimator, detector, other_cell(rng))  # между проездами ячейки — отрезок в другой
    shift = None
    for count in range(1, 8):
        shift = feed(estimator, detector, cell_pass(new_cost, rng))
        if shift:
            break
        feed(estimator, detector, other_cell(rng))
    assert shift is not None and shift.rising is rising and count <= 3  # не позже второго-третьего проезда
    assert shift.new_level == pytest.approx(new_cost, abs=0.4)


def test_single_pass_is_not_enough_for_alarm():
    rng = random.Random(2)
    estimator, detector = TerrainEstimator(), TerrainChangeDetector()
    for _ in range(6):
        feed(estimator, detector, cell_pass(1.0, rng))
        feed(estimator, detector, other_cell(rng))
    alarms = [feed(estimator, detector, cell_pass(3.0, rng)) for _ in range(5)]  # один длинный проезд
    assert not any(alarms)


def test_detector_has_no_false_alarm_on_stable_noisy_terrain_and_turns():
    rng = random.Random(7)
    estimator, detector = TerrainEstimator(), TerrainChangeDetector()
    alarms = [feed(estimator, detector, cell_pass(1.0, rng, noise=0.03, rotation=rng.choice([0.0, 1.5])))
              for _ in range(200)]
    assert not any(alarms)


def test_costly_terrain_hypothesis_three_outcomes_from_independent_measurements():
    def prepared():
        estimator = TerrainEstimator(prior_energy_per_m=1.0)
        for x, drop in ((0.0, 1.0), (1.0, 1.0), (2.0, 3.5), (3.0, 1.0)):
            for _ in range(2):
                estimator.record(TravelSegment(Point(x, 0), Point(x + 1, 0), 1.0, drop, 5.0))
        book = HypothesisBook(max_attempts=1)
        hypothesis = book.propose(estimator)
        book.start_experiment(hypothesis, estimator)
        return estimator, book, hypothesis

    estimator, book, hypothesis = prepared()
    assert hypothesis.prediction.confirm_at_least is not None  # прогноз записан до проверки
    assert hypothesis.evidence and min(hypothesis.evidence) >= 1
    x = hypothesis.center.x_m - 0.2
    estimator.record(TravelSegment(Point(x, 0), Point(x + 0.4, 0), 0.4, 0.4 * 3.4, 2.0))
    assert book.evaluate(hypothesis, estimator) is HypothesisStatus.CONFIRMED

    estimator, book, hypothesis = prepared()
    x = hypothesis.center.x_m - 0.2
    estimator.record(TravelSegment(Point(x, 0), Point(x + 0.4, 0), 0.4, 0.4 * 1.0, 2.0))
    assert book.evaluate(hypothesis, estimator) is HypothesisStatus.REFUTED

    estimator, book, hypothesis = prepared()
    assert book.evaluate(hypothesis, estimator) is None
    assert book.give_up_or_retry(hypothesis) is HypothesisStatus.UNVERIFIED


def test_hazard_hits_merge_and_routes_pay_for_crossing():
    hazards = HazardMap()
    first, new = hazards.record_hit(Point(0, 0), 10.0)
    again, new_again = hazards.record_hit(Point(0.3, 0), 12.0)
    assert new and not new_again and again.detection_id == first.detection_id and again.hits == 2
    assert again.radius_m > first.radius_m
    assert hazards.cost_multiplier(Point(0.1, 0)) > 1 and hazards.cost_multiplier(Point(3, 3)) == 1
    assert hazards.crossings(Point(-1, 0), [Point(1, 0)]) == 1 and hazards.crossings(Point(-1, 2), [Point(1, 2)]) == 0


def run_sensor(monitor, values, start=0.0, step=0.2):
    transitions = []
    for index, value in enumerate(values):
        transitions += monitor.update(value, start + index * step)
    return transitions


@pytest.mark.parametrize("fault, values", [
    (SensorFault.NOISE, None),
    (SensorFault.STUCK, [0.42] * 40),
    (SensorFault.DROPOUT, [None] * 40),
])
def test_sensor_faults_detected_and_recovery_confirmed(fault, values):
    rng = random.Random(3)
    monitor = SensorHealthMonitor()
    run_sensor(monitor, [0.4 + rng.gauss(0, 0.03) for _ in range(40)])
    assert monitor.state is SensorState.OK
    if values is None:
        values = [min(1, max(0, 0.4 + rng.gauss(0, 0.25))) for _ in range(60)]
    transitions = run_sensor(monitor, values, start=8.0)
    assert monitor.state is SensorState.DEGRADED and monitor.fault is fault
    assert transitions[0].state is SensorState.SUSPECTED and transitions[0].detection_id == "sensor-1"
    run_sensor(monitor, [0.4 + rng.gauss(0, 0.03) for _ in range(60)], start=30.0)
    assert monitor.state is SensorState.OK and monitor.quality == 1.0


def test_sensor_normal_causes_do_not_raise_alarms():
    rng = random.Random(5)
    monitor = SensorHealthMonitor()
    # приближение к образцу, насыщение на 1.0, сбор (падение уровня), смена ближайшего образца
    approach = [min(1.0, 0.3 + 0.02 * i + rng.gauss(0, 0.03)) for i in range(40)]
    saturated = [1.0] * 30
    run_sensor(monitor, approach + saturated)
    monitor.note_collect()
    after = [max(0.0, 0.15 + rng.gauss(0, 0.03)) for _ in range(40)] + [0.6 + rng.gauss(0, 0.03) for _ in range(40)]
    transitions = run_sensor(monitor, after, start=20.0)
    assert monitor.state is SensorState.OK and not transitions


# ---- сквозные сценарии на подменной среде

def shuttle_goals(count, a=Point(-1.4, -1.5), b=Point(0.6, -1.5)):
    return [Subgoal(GoalKind.EXPLORE, b if index % 2 == 0 else a, "челнок через зону", source="llm")
            for index in range(count)]


def test_hidden_terrain_change_is_detected_logged_and_changes_the_model():
    clock = FakeClock()
    zone = Zone(Point(-0.4, -1.5), 0.6, 1.0)
    world = SimWorld(clock, [Point(3.0, 2.5)], zones=[zone], battery=200.0,
                     schedule=[(70.0, WorldChange("soil_up", zone_index=0, zone_energy_per_m=3.0))])
    settings = SETTINGS.__class__(battery_initial=200.0, max_decisions=200)
    controller, mission, journal = make_controller(world, clock, settings=settings,
                                                   planner=ScriptedPlanner(shuttle_goals(14)))
    run_ticks(controller, world, mission, max_ticks=3500)
    entries = [entry.draft for entry in journal.tail(mission.run_id, 3000)]
    detections = [d for d in entries if d.title.startswith("Обнаружено изменение грунта")]
    assert detections, [d.title for d in entries]
    detection = detections[0]
    change_time = world.applied_changes[0][0]
    assert detection.simulation_time_s > change_time  # не раньше скрытого изменения
    assert detection.detection_id and detection.evidence
    linked = [d for d in entries if d.detection_id == detection.detection_id]
    assert any(d.title in ("Перепланирование", "Модель обновлена") for d in linked)
    estimate = controller._estimator.estimate_at(Point(-0.4, -1.5))
    assert estimate.regime >= 1 and estimate.energy_per_m > 2.0


def test_hazard_event_marks_area_and_reroutes():
    clock = FakeClock()
    hazard = Zone(Point(-0.8, -1.5), 0.25, 0.0)
    world = SimWorld(clock, [Point(3.0, 2.5)], hazards=[hazard], battery=200.0)
    settings = SETTINGS.__class__(battery_initial=200.0, max_decisions=200)
    controller, mission, journal = make_controller(world, clock, settings=settings, events=world,
                                                   planner=ScriptedPlanner(shuttle_goals(4)))
    run_ticks(controller, world, mission, max_ticks=2500)
    entries = [entry.draft for entry in journal.tail(mission.run_id, 3000)]
    assert any(d.title == "Наблюдаемая опасная область" and d.detection_id == "hazard-1" for d in entries)
    hits = [event for event in world.events if event.kind is EventKind.HAZARD_HIT]
    assert len(hits) <= 2, "после первого попадания маршрут должен обходить область"


def test_stuck_sensor_blocks_blind_collects_then_returns_honestly():
    clock = FakeClock()
    world = SimWorld(clock, [Point(-1.2, -0.5)], schedule=[(1.0, WorldChange("stuck", sensor_mode="stuck"))])
    controller, mission, journal = make_controller(world, clock)
    run_ticks(controller, world, mission, max_ticks=6000)
    entries = [entry.draft for entry in journal.tail(mission.run_id, 3000)]
    titles = [d.title for d in entries]
    assert "Неисправность датчика подтверждена" in titles
    assert world.collected == 0 and not any(e.kind is EventKind.FALSE_COLLECT for e in world.events)
    assert mission.status is MissionStatus.FAILED and mission.snapshot().last_error.code == "no_confirmed_sample"


def test_costly_terrain_hypotheses_are_limited_per_run():
    estimator = TerrainEstimator(prior_energy_per_m=1.0)
    for x, drop in ((0.0, 1.0), (1.0, 3.5), (2.0, 1.0), (3.0, 3.5), (4.0, 1.0), (5.0, 3.5), (6.0, 1.0)):
        for _ in range(2):
            estimator.record(TravelSegment(Point(x, 0), Point(x + 1, 0), 1.0, drop, 5.0))
    book = HypothesisBook(max_costly_terrain=2)
    proposed = []
    while (item := book.propose(estimator)) is not None:
        book.defer(item)
        proposed.append(item)
    assert len(proposed) == 2
