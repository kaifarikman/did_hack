import dataclasses

from did_judge.config import JudgeConfig
from did_judge.engine import JudgeEngine
from did_judge.scenario import Scenario, SoilZone


def drive(engine, start, end, steps=10, time_start=0.0):
    for step in range(1, steps + 1):
        fraction = step / steps
        engine.update_pose(start[0] + (end[0] - start[0]) * fraction,
                           start[1] + (end[1] - start[1]) * fraction,
                           0.0, time_start + step)


def test_battery_starts_at_sixty_and_never_increases(fixed_engine):
    levels = [fixed_engine.battery]
    for step in range(1, 20):
        fixed_engine.update_pose(-2.0 + step * 0.05, -0.5, 0.0, step)
        levels.append(fixed_engine.battery)
    assert levels[0] == 60.0
    assert all(later <= earlier for earlier, later in zip(levels, levels[1:]))


def test_same_distance_costs_more_inside_soil(config):
    scenario = Scenario(1, ((0.0, 1.5),), (SoilZone((-1.0, -0.5), 0.5),))
    plain, soil = JudgeEngine(scenario, config), JudgeEngine(scenario, config)
    plain.update_pose(-2.0, 1.0, 0.0, 0.0)
    soil.update_pose(-1.25, -0.5, 0.0, 0.0)
    drive(plain, (-2.0, 1.0), (-1.75, 1.0))
    drive(soil, (-1.25, -0.5), (-1.0, -0.5))
    assert 60.0 - soil.battery > 60.0 - plain.battery
    assert abs((60.0 - plain.battery) - 0.25 * config.energy_per_m) < 1e-9
    assert abs((60.0 - soil.battery)
               - 0.25 * (config.energy_per_m + config.soil_surcharge_per_m)) < 1e-9


def test_pose_jump_is_not_charged(fixed_engine):
    fixed_engine.update_pose(5.0, 5.0, 0.0, 1.0)
    assert fixed_engine.battery == 60.0


def test_collect_radius_is_strict(config):
    scenario = Scenario(1, ((0.0, 1.5),), ())
    inside, boundary = JudgeEngine(scenario, config), JudgeEngine(scenario, config)
    inside.update_pose(0.0, 1.5 - 0.299, 0.0, 0.0)
    boundary.update_pose(0.0, 1.5 - 0.30, 0.0, 0.0)
    assert inside.collect().success
    assert not boundary.collect().success


def test_sample_is_collected_once(fixed_engine):
    fixed_engine.update_pose(0.0, 1.5, 0.0, 1.0)
    assert fixed_engine.collect().success
    assert not fixed_engine.collect().success
    assert fixed_engine.collected == 1


def test_false_collect_costs_battery_and_emits_event(fixed_engine):
    before = fixed_engine.battery
    assert not fixed_engine.collect().success
    assert fixed_engine.battery < before
    assert [event.kind for event in fixed_engine.events] == ["false_collect"]


def test_collected_sample_leaves_the_sensor(fixed_engine):
    fixed_engine.update_pose(0.0, 1.5, 0.0, 1.0)
    fixed_engine.collect()
    assert fixed_engine.sample_signal() == 0.0


def test_sensor_is_noisy_bounded_and_stronger_near_sample(config):
    scenario = Scenario(1, ((0.0, 1.5),), ())
    engine = JudgeEngine(scenario, config)
    engine.update_pose(0.0, 1.4, 0.0, 0.0)
    near = [engine.sample_signal() for _ in range(200)]
    engine.update_pose(0.0, 1.4 - 3.0, 0.0, 1.0)
    far = [engine.sample_signal() for _ in range(200)]
    assert all(0.0 <= value <= 1.0 for value in near + far)
    assert len(set(near)) > 10
    assert sum(near) / 200 > sum(far) / 200 + 0.3


def test_finish_away_from_base_fails(fixed_engine):
    drive(fixed_engine, (-2.0, -0.5), (-1.0, -0.5))
    result = fixed_engine.finish()
    assert not result.success and result.message == "not_at_base"
    assert not fixed_engine.finish_success


def test_finish_at_base_with_battery_succeeds_once(fixed_engine):
    assert fixed_engine.finish().success
    assert fixed_engine.finish().message == "already_finished"
    fixed_engine.update_pose(-1.0, -0.5, 0.0, 5.0)
    assert fixed_engine.battery == 60.0  # после завершения расход не идёт


def test_depleted_battery_blocks_collect_and_finish(config):
    cheap = dataclasses.replace(config, battery_initial=1.0)
    engine = JudgeEngine(Scenario(1, ((0.0, 1.5),), ()), cheap)
    engine.update_pose(-2.0, -0.5, 0.0, 0.0)
    drive(engine, (-2.0, -0.5), (-1.0, -0.5))
    assert engine.battery == 0.0
    assert not engine.collect().success
    assert engine.finish().message == "battery_depleted"
    assert engine.state_label() == "depleted"


def test_collision_penalty_and_event(fixed_engine):
    fixed_engine.register_collision()
    assert fixed_engine.collisions == 1
    assert fixed_engine.battery == 60.0 - fixed_engine.config.collision_penalty_energy
    assert fixed_engine.events[-1].kind == "collision"


def test_score_counts_samples_and_penalties(fixed_engine):
    fixed_engine.update_pose(0.0, 1.5, 0.0, 1.0)
    fixed_engine.collect()
    fixed_engine.register_collision()
    expected = (JudgeConfig().score_per_sample - JudgeConfig().score_per_collision)
    assert fixed_engine.score() == expected
