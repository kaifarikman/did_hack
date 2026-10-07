import math
from dataclasses import replace

import pytest

from did_judge.dynamics import (
    SENSOR_DROPOUT, SENSOR_NOISY, SENSOR_STUCK, EventSchedule, SensorFault, generate_event_schedule,
)
from did_judge.engine import JudgeEngine
from did_judge.scenario import Scenario, SoilZone, generate_scenario


def hard_config(config):
    return replace(config, sample_count=7, soil_zone_count=4, dynamic_events=True)


def test_schedule_is_reproducible_and_seed_dependent(grid, config):
    hard = hard_config(config)
    scenario = generate_scenario(3, grid, hard)
    assert generate_event_schedule(3, grid, hard, scenario) == generate_event_schedule(3, grid, hard, scenario)
    assert generate_event_schedule(4, grid, hard, scenario) != generate_event_schedule(3, grid, hard, scenario)


def test_schedule_times_fall_in_window(grid, config):
    hard = hard_config(config)
    scenario = generate_scenario(5, grid, hard)
    schedule = generate_event_schedule(5, grid, hard, scenario)
    low, high = hard.event_earliest_s, hard.event_earliest_s + hard.event_window_s
    times = [schedule.soil_shift_time_s, schedule.hazard_time_s] + [f.start_s for f in schedule.sensor_faults]
    assert all(low <= value <= high for value in times)
    assert {f.kind for f in schedule.sensor_faults} == {SENSOR_DROPOUT, SENSOR_STUCK, SENSOR_NOISY}


def test_events_do_not_change_initial_layout(grid, config):
    hard = hard_config(config)
    assert generate_scenario(2, grid, hard) == generate_scenario(2, grid, replace(hard, dynamic_events=False))


def make_engine(config, schedule):
    scenario = Scenario(1, ((0.0, 1.5),), (SoilZone((-1.0, -0.5), 0.5),))
    engine = JudgeEngine(scenario, config, schedule=schedule)
    engine.update_pose(*config.base_world_m, 0.0, 0.0)
    return engine


def schedule_with(faults=(), shift=10.0, hazard=10.0):
    return EventSchedule(shift, 0, (1.0, 1.0), hazard, SoilZone((0.5, -0.5), 0.3), tuple(faults))


def test_soil_moves_after_shift_time(config):
    schedule = schedule_with()
    scenario = Scenario(1, (), (SoilZone((-1.0, -0.5), 0.5),))
    assert schedule.soil_zones_at(scenario, 9.0)[0].center == (-1.0, -0.5)
    assert schedule.soil_zones_at(scenario, 11.0)[0].center == (1.0, 1.0)


def test_old_soil_is_cheap_after_shift(config):
    """Один и тот же проезд до и после смены стоит по-разному."""
    def cost(time_s):
        engine = make_engine(config, schedule_with())
        before = engine.battery
        engine.update_pose(-1.1, -0.5, 0.0, time_s)
        engine.update_pose(-0.9, -0.5, 0.0, time_s + 0.1)
        return before - engine.battery
    assert cost(1.0) > cost(20.0)


def test_hazard_hit_once_per_entry_with_penalty(config):
    engine = make_engine(config, schedule_with())
    engine.update_pose(-0.5, -0.5, 0.0, 11.0)
    start = engine.battery
    engine.update_pose(0.2, -0.5, 0.0, 12.0)
    engine.update_pose(0.45, -0.5, 0.0, 12.5)
    engine.update_pose(0.5, -0.5, 0.0, 13.0)
    hits = [event for event in engine.events if event.kind == "hazard_hit"]
    assert len(hits) == 1
    assert start - engine.battery >= config.hazard_penalty_energy


def test_hazard_absent_before_appearance(config):
    engine = make_engine(config, schedule_with(hazard=100.0))
    engine.update_pose(0.45, -0.5, 0.0, 12.0)
    assert not [event for event in engine.events if event.kind == "hazard_hit"]


def test_sensor_dropout_returns_none(config):
    engine = make_engine(config, schedule_with([SensorFault(SENSOR_DROPOUT, 5.0, 15.0)]))
    engine.update_pose(*config.base_world_m, 0.0, 6.0)
    assert engine.sample_signal() is None
    engine.update_pose(*config.base_world_m, 0.0, 16.0)
    assert engine.sample_signal() is not None


def test_sensor_stuck_repeats_last_value(config):
    engine = make_engine(config, schedule_with([SensorFault(SENSOR_STUCK, 5.0, 15.0)]))
    engine.update_pose(*config.base_world_m, 0.0, 1.0)
    last = engine.sample_signal()
    engine.update_pose(0.0, 1.0, 0.0, 6.0)
    assert engine.sample_signal() == last


def test_noisy_fault_increases_spread(config):
    def spread(faults):
        engine = make_engine(config, schedule_with(faults))
        engine.update_pose(0.0, 1.0, 0.0, 6.0)
        values = [engine.sample_signal() for _ in range(300)]
        mean = sum(values) / len(values)
        return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))
    assert spread([SensorFault(SENSOR_NOISY, 5.0, 15.0)]) > 2 * spread([])
