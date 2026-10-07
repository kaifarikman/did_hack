"""Измерения расхода на пути: выравнивание по батарее, повороты, несколько ячеек — через публичные интерфейсы."""
import pytest

from application.segments import SegmentAccumulator
from domain.geometry import Point, Pose
from domain.observations import Observation
from fakes import FakeClock, SimWorld, Zone
from harness import make_controller, run_ticks


def observation(x, battery, time_s, heading=0.0):
    return Observation(time_s, Pose(x, 0.0, heading), battery, None, 1000.0 + time_s)


def test_segment_closes_only_when_battery_updates_and_keeps_path():
    accumulator = SegmentAccumulator(min_length_m=0.5)
    assert accumulator.add(observation(0.0, 60.0, 0.0), 0.0, False) is None
    assert accumulator.add(observation(0.1, 59.9, 0.1), 0.1, False) is None  # первое обновление батареи — старт
    segment = None
    battery, x = 59.9, 0.1
    for step in range(2, 12):
        x += 0.06
        if step % 2 == 0:
            battery = 59.9 - (x - 0.1)  # батарея обновляется через тик, поза — каждый тик
        segment = accumulator.add(observation(x, round(battery, 3), step * 0.1), step * 0.1, False) or segment
    assert segment is not None
    assert segment.distance_m == pytest.approx(segment.end.x_m - segment.start.x_m)
    assert segment.battery_drop == pytest.approx(segment.distance_m * 1.0, rel=0.05)  # 1 ед./м
    assert len(segment.path) >= 3 and segment.path[0] == segment.start


def test_penalty_inside_segment_marks_it_and_discard_drops_partial():
    accumulator = SegmentAccumulator(min_length_m=0.2)
    accumulator.add(observation(0.0, 60.0, 0.0), 0.0, False)
    accumulator.add(observation(0.1, 59.9, 0.1), 0.1, False)
    accumulator.add(observation(0.2, 59.9, 0.2), 0.2, True)
    flagged = accumulator.add(observation(0.4, 59.6, 0.3), 0.3, False)
    assert flagged is not None and flagged.penalty_flagged
    accumulator.discard()
    assert accumulator.add(observation(0.8, 59.0, 0.4), 0.4, False) is None


def test_mission_estimates_zone_cost_without_rotation_bias():
    clock = FakeClock()
    zone = Zone(Point(0.5, -0.5), 0.7, 3.0)
    world = SimWorld(clock, [Point(2.5, -1.5)], zones=[zone], rotation_energy_per_rad=0.1, seed=4)
    controller, mission, _ = make_controller(world, clock)
    run_ticks(controller, world, mission, max_ticks=6000)
    estimator = controller._estimator
    inside = estimator.estimate_at(Point(0.5, -0.5))
    measured_outside = [
        estimate.energy_per_m for _, bucket, estimate in estimator.detailed_regions()
        if estimate.distance_m >= 0.5
        and world.energy_per_m_at(estimator.bucket_center(bucket)) == 1.0
        and all(world.energy_per_m_at(Point(estimator.bucket_center(bucket).x_m + dx, estimator.bucket_center(bucket).y_m + dy)) == 1.0
                for dx in (-0.25, 0.25) for dy in (-0.25, 0.25))
    ]
    assert measured_outside, "агент должен был измерить обычный грунт"
    assert sum(measured_outside) / len(measured_outside) == pytest.approx(1.0, abs=0.35)
    if inside.distance_m >= 0.5:
        assert inside.energy_per_m > 2.0
    assert estimator.rotation_energy_per_rad == pytest.approx(0.1, abs=0.06)
