"""Подменная среда для проверки ядра без ROS: скрытые изменения, отказ датчика, SLAM-карта, команда."""
from domain.events import EventKind
from domain.geometry import Point, Pose
from domain.grid import UNKNOWN
from fakes import FakeClock, GrowingMap, SimWorld, TeamWorld, WorldChange, Zone, build_arena


def _drive(world, linear, seconds, dt_s=0.1):
    world.command(linear, 0.0)
    for _ in range(round(seconds / dt_s)):
        world.advance(dt_s)


def test_scheduled_terrain_change_is_hidden_until_measured():
    clock = FakeClock()
    zone = Zone(Point(-1.0, -0.5), 2.0, 1.0)
    world = SimWorld(clock, [], zones=[zone], schedule=[(5.0, WorldChange("soil_up", 0, 3.0))])
    start = world.battery
    _drive(world, 0.1, 4.0)
    before = start - world.battery
    middle = world.battery
    _drive(world, 0.1, 4.0)
    after = middle - world.battery
    assert after > 2.0 * before
    assert [label for _, label in world.applied_changes] == ["soil_up"]


def test_hazard_hit_costs_energy_and_emits_public_event_once_per_entry():
    clock = FakeClock()
    hazard = Zone(Point(-1.5, -0.5), 0.2, 0.0)
    world = SimWorld(clock, [], schedule=[(0.5, WorldChange("hazard", hazard=hazard))])
    _drive(world, 0.15, 6.0)
    assert [event.kind for event in world.events] == [EventKind.HAZARD_HIT]
    assert world.battery < 60.0 - 0.9 - 1.0 + 0.05


def test_sensor_modes_noise_stuck_dropout_and_reset_restores():
    clock = FakeClock()
    world = SimWorld(clock, [Point(0.0, -0.5)])
    world.set_sensor("stuck")
    first = world.latest().sample_signal
    _drive(world, 0.15, 3.0)
    assert world.latest().sample_signal == first
    world.set_sensor("dropout")
    assert world.latest().sample_signal is None
    world.set_sensor("noisy", 0.3)
    readings = {round(world.latest().sample_signal, 3) for _ in range(20)}
    assert len(readings) > 5
    from application.ports import ResetRequest
    world.reset(ResetRequest("hard", 1, 2))
    assert world.sensor_mode == "ok" and world.latest().sample_signal is not None


def test_growing_map_reveals_cells_and_increments_revision():
    clock = FakeClock()
    world = SimWorld(clock, [])
    slam = GrowingMap(build_arena(), lambda: world.pose)
    assert slam.load() is None
    slam.observe()
    first = slam.load()
    assert first.revision == 1 and UNKNOWN in first.cells
    known_before = sum(1 for cell in first.cells if cell != UNKNOWN)
    _drive(world, 0.15, 10.0)
    slam.observe()
    second = slam.load()
    assert second.revision == 2 and sum(1 for cell in second.cells if cell != UNKNOWN) > known_before
    slam.observe()
    assert slam.load().revision == 2  # без новых клеток версия не меняется


def test_team_world_collects_each_sample_once():
    clock = FakeClock()
    sample = Point(-1.0, 0.0)
    team = TeamWorld(clock, [sample], {"robot_1": Pose(-1.1, 0.0, 0.0), "robot_2": Pose(-0.9, 0.0, 3.14)})
    first, second = team.robots["robot_1"].collect(), team.robots["robot_2"].collect()
    assert first.success and not second.success
    assert team.total_collected == 1 and team.collected_by == {"robot_1": 1, "robot_2": 0}
    assert team.robots["robot_2"].latest().sample_signal == 0.0  # образцов не осталось
