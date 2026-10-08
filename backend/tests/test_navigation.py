"""Задача «дойти до точки и вернуться» (контракт D1): проверка цели, фазы, возврат, finish и отказы."""
from __future__ import annotations

from dataclasses import replace

import pytest

from adapters.journal.memory import InMemoryJournal
from application.errors import (
    InvalidRequest, MapChanged, NavigationTargetUnreachable, RunConflict, ScenarioUnavailable,
)
from application.ports import JudgeReply, OperationOutcome
from application.run_service import RunService
from domain.errors import InvalidTransition
from domain.geometry import Point, Pose
from domain.grid import OccupancyGrid
from domain.mission import Mission, MissionStatus
from domain.navigation_task import NavigationPhase, NavigationTarget, NavigationTask, TaskType
from fakes import FakeClock, FakeEnvironment, ScriptedPlanner, SimWorld, StaticMap, TimeoutJudge, build_arena
from harness import SETTINGS, make_controller

MAP_ID = "test-arena"
TARGET = Point(1.5, 1.5)
SAMPLES = [Point(1.5, 1.0)]


def target(point: Point = TARGET, map_id: str = MAP_ID) -> NavigationTarget:
    return NavigationTarget(point, map_id)


def arena_with_walls(*boxes: tuple[int, int, int, int], revision: int = 0) -> OccupancyGrid:
    """Арена с дополнительными стенами: (col_min, row_min, col_max, row_max) — рамка из занятых клеток."""
    arena = build_arena()
    cells = list(arena.cells)
    for col_min, row_min, col_max, row_max in boxes:
        for row in range(row_min, row_max + 1):
            for column in range(col_min, col_max + 1):
                if row in (row_min, row_max) or column in (col_min, col_max):
                    cells[row * arena.width + column] = 100
    return OccupancyGrid(arena.map_id, arena.resolution_m, arena.width, arena.height, arena.origin, cells, revision)


# кольцо стен вокруг (2.5, 1.5): внутри свободно, но пути нет
RING_AROUND_FAR_POINT = (60, 40, 70, 50)
FAR_POINT = Point(2.5, 1.5)


class RecordingWorld(SimWorld):
    """Запоминает каждую ненулевую команду скорости: доказательство «движение не начато»."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.moving_commands = 0

    def command(self, linear_mps: float, angular_radps: float) -> None:
        if linear_mps or angular_radps:
            self.moving_commands += 1
        super().command(linear_mps, angular_radps)


class RejectingFinishJudge:
    def __init__(self, world: SimWorld) -> None:
        self._world = world

    def collect(self) -> JudgeReply:
        return self._world.collect()

    def finish(self) -> JudgeReply:
        self._world.finish()
        return JudgeReply(False, "not_at_base")


class Stack:
    def __init__(self, world: SimWorld | None = None, settings=SETTINGS, maps=None, judge=None, score=None,
                 planner=None, environment=None) -> None:
        self.clock = world.clock if world is not None else FakeClock()
        self.world = world or RecordingWorld(self.clock, SAMPLES)
        self.journal = InMemoryJournal()
        self.maps = maps or StaticMap()
        self.planner = planner
        counter = iter(range(1, 1000))

        def factory(mission: Mission, link=None):
            controller, _, _ = make_controller(
                self.world, self.clock, journal=self.journal, mission=mission, settings=settings, judge=judge,
                score=score, planner=planner, maps=self.maps)
            return controller

        self.service = RunService(environment or FakeEnvironment(), self.maps, self.journal, factory, settings,
                                  id_factory=lambda: f"run-{next(counter)}")

    def start(self, request_id: str = "nav-1", goal: NavigationTarget | None = None, **overrides):
        scenario = overrides.pop("scenario", "easy")
        arguments = {"task_type": "navigation", "navigation_target": goal or target(), **overrides}
        return self.service.start_run(request_id, scenario, 1, **arguments)

    def run(self, until=lambda snapshot: snapshot.status.is_terminal, max_ticks: int = 20000):
        for _ in range(max_ticks):
            self.world.advance()
            self.service.tick()
            snapshot = self.service.state()
            if until(snapshot) or snapshot.status.is_terminal:
                return snapshot
        return self.service.state()

    def titles(self, run_id: str) -> list[str]:
        return [entry.draft.title for entry in self.journal.tail(run_id, 10000)]


# ------------------------------------------------------------------ domain


def test_navigation_task_phase_follows_status_and_keeps_phase_while_stopping():
    task = NavigationTask(target(), 0.12)
    mission = Mission("r", "easy", 1, "local", "fallback", MAP_ID, SETTINGS.base, 60.0, navigation=task)
    assert mission.task_type is TaskType.NAVIGATION and mission.navigation.phase is NavigationPhase.PENDING
    mission.mark_running()
    assert mission.navigation.phase is NavigationPhase.MOVING_TO_TARGET
    mission.request_stop()
    assert mission.snapshot().navigation.phase is NavigationPhase.MOVING_TO_TARGET  # ещё не подтверждено
    mission.confirm_stopped()
    assert mission.snapshot().navigation.phase is NavigationPhase.STOPPED


def test_completion_requires_reached_target_and_reach_is_recorded_once():
    mission = Mission("r", "easy", 1, "local", "fallback", MAP_ID, SETTINGS.base, 60.0,
                      navigation=NavigationTask(target(), 0.12))
    mission.mark_running()
    mission.update_telemetry(1.0, Pose(-2.0, -0.5, 0.0), 50.0, None)
    mission.begin_return()
    with pytest.raises(InvalidTransition):
        mission.complete(True, require_sample=False)
    assert mission.mark_target_reached(12.5) and not mission.mark_target_reached(20.0)
    assert mission.navigation.target_reached_at_s == 12.5
    mission.complete(True, require_sample=False)
    assert mission.navigation.phase is NavigationPhase.FINISHED


def test_reach_is_decided_by_pose_and_tolerance():
    task = NavigationTask(target(Point(1.0, 1.0)), 0.12)
    assert task.is_reached_by(Point(1.1, 1.0)) and not task.is_reached_by(Point(1.13, 1.0))
    with pytest.raises(ValueError):
        NavigationTask(target(), 0.0)


def test_scan_overlay_on_target_is_transient_but_map_obstacle_is_not():
    from application.navigation_goal import TargetProblem, assess_navigation_target
    from application.navigation_service import NavigationService
    from domain.energy import TerrainEstimator

    navigation = NavigationService(build_arena(), TerrainEstimator(), SETTINGS)
    assert assess_navigation_target(navigation, SETTINGS, SETTINGS.base, TARGET, 60.0).accepted
    navigation.observe_dynamic_obstacles((TARGET,), now_s=10.0)
    navigation.observe_dynamic_obstacles((TARGET,), now_s=10.1)  # второе подтверждение
    occupied = assess_navigation_target(navigation, SETTINGS, SETTINGS.base, TARGET, 60.0)
    assert occupied.problem is TargetProblem.OCCUPIED_NOW and occupied.problem.transient
    pillar = assess_navigation_target(navigation, SETTINGS, SETTINGS.base, Point(0.0, 0.5), 60.0)
    assert pillar.problem is TargetProblem.BLOCKED and not pillar.problem.transient
    assert not TargetProblem.ENERGY.transient and not TargetProblem.OUTSIDE_MAP.transient


# ------------------------------------------------------------ start checks


def test_research_without_new_fields_is_unchanged():
    stack = Stack()
    snapshot = stack.service.start_run("r", "easy", 1)
    assert snapshot.task_type is TaskType.RESEARCH and snapshot.navigation is None


@pytest.mark.parametrize(("task_type", "goal", "message"), [
    ("navigation", None, "нужна"),
    ("research", target(), "null"),
    ("patrol", None, "неизвестен"),
    ("navigation", target(Point(float("nan"), 0.0)), "конечными"),
    ("navigation", target(Point(0.0, float("inf"))), "конечными"),
    ("navigation", target(map_id=""), "map_id"),
])
def test_invalid_field_combinations_are_rejected_without_reset(task_type, goal, message):
    stack = Stack()
    with pytest.raises(InvalidRequest, match=message):
        stack.service.start_run("x", "easy", 1, task_type=task_type, navigation_target=goal)
    assert stack.world.reset_calls == 0 and stack.service._current is None


@pytest.mark.parametrize("overrides", [
    {"scenario": "medium"}, {"map_mode": "slam"}, {"robot_count": 2},
])
def test_navigation_outside_easy_static_single_robot_is_unavailable(overrides):
    environment = FakeEnvironment(scenarios=("easy", "medium"), map_modes=("static", "slam"), robot_counts=(1, 2))
    stack = Stack(environment=environment)
    with pytest.raises(ScenarioUnavailable):
        stack.start(**overrides)
    assert stack.world.reset_calls == 0


@pytest.mark.parametrize(("goal", "message"), [
    (Point(9.0, 0.0), "вне границ"),
    (Point(0.0, 0.5), "препятствии"),  # столб арены
    (Point(-3.95, 0.0), "запаса корпуса"),  # клетка у внешней стены
    (FAR_POINT, "Нет допустимого пути"),
])
def test_unreachable_target_is_rejected_before_reset(goal, message):
    stack = Stack(maps=StaticMap(arena_with_walls(RING_AROUND_FAR_POINT)))
    with pytest.raises(NavigationTargetUnreachable, match=message):
        stack.start(goal=target(goal))
    assert stack.world.reset_calls == 0 and stack.service._current is None


def test_target_beyond_energy_budget_is_rejected_before_reset():
    stack = Stack(settings=replace(SETTINGS, battery_initial=10.0))
    with pytest.raises(NavigationTargetUnreachable, match="энергии"):
        stack.start(goal=target(Point(3.0, 2.0)))
    assert stack.world.reset_calls == 0


def test_stale_map_id_is_map_changed():
    stack = Stack()
    with pytest.raises(MapChanged):
        stack.start(goal=target(map_id="test-arena#r7"))
    assert stack.world.reset_calls == 0


def test_same_request_replays_and_changed_target_conflicts():
    stack = Stack()
    first = stack.start("same")
    stack.world.advance()
    stack.service.tick()
    again = stack.start("same")
    assert again.run_id == first.run_id and stack.world.reset_calls == 1 and len(stack.service._runs) == 1
    with pytest.raises(RunConflict):
        stack.start("same", goal=target(Point(1.0, 1.5)))
    with pytest.raises(RunConflict):
        stack.start("other")  # активный прогон


# ------------------------------------------------------------- execution


def test_reachable_target_is_reached_then_robot_returns_and_finish_completes():
    planner = ScriptedPlanner([])
    stack = Stack(planner=planner, environment=FakeEnvironment(llm=True))
    started = stack.start()
    assert started.navigation.phase is NavigationPhase.PENDING and started.planner_mode == "fallback"
    returning = stack.run(until=lambda snapshot: snapshot.status is MissionStatus.RETURNING)
    assert returning.status is MissionStatus.RETURNING and returning.navigation.target_reached
    assert returning.navigation.phase is NavigationPhase.RETURNING
    assert returning.current_goal.kind.value == "return" and returning.planned_path
    final = stack.run()
    assert final.status is MissionStatus.COMPLETED, final.last_error
    assert final.navigation.phase is NavigationPhase.FINISHED and final.navigation.target_reached_at_s is not None
    assert final.samples_collected == 0 and stack.world.collected == 0 and stack.world.finish_success
    assert planner.calls == 0  # детерминированный режим: LLM не участвует
    titles = stack.titles(final.run_id)
    order = [titles.index(name) for name in ("navigation_target_set", "navigation_target_reached",
                                              "navigation_return_started", "Миссия завершена")]
    assert order == sorted(order)
    assert all(titles.count(name) == 1 for name in ("navigation_target_set", "navigation_target_reached",
                                                     "navigation_return_started"))
    reached = next(entry.draft for entry in stack.journal.tail(final.run_id, 1000)
                   if entry.draft.title == "navigation_target_reached")
    assert "generation:1" in reached.evidence and any(item.startswith("route_revision:") for item in reached.evidence)


def test_target_reached_is_measured_from_observed_pose():
    stack = Stack()
    stack.start()
    returning = stack.run(until=lambda snapshot: snapshot.navigation.target_reached)
    reached_pose = returning.robot_pose.point
    assert ((reached_pose.x_m - TARGET.x_m) ** 2 + (reached_pose.y_m - TARGET.y_m) ** 2) ** 0.5 <= 0.12


def test_stop_during_motion_stops_robot_and_is_not_success():
    stack = Stack()
    run_id = stack.start().run_id
    stack.run(until=lambda snapshot: snapshot.planned_path and stack.world.linear > 0, max_ticks=200)
    stopping = stack.service.stop_run("stop", run_id)
    assert stopping.status is MissionStatus.STOPPING
    stack.service.tick()
    final = stack.service.state()
    assert final.status is MissionStatus.STOPPED and final.navigation.phase is NavigationPhase.STOPPED
    assert not final.navigation.target_reached and stack.world.linear == 0 and stack.world.angular == 0
    assert not stack.world.finished


def test_after_reset_low_battery_fails_check_without_any_motion():
    world = RecordingWorld(FakeClock(), SAMPLES, battery=8.0)  # фактическая батарея ниже обещанной профилем
    stack = Stack(world=world)
    stack.start()
    final = stack.run(max_ticks=50)
    assert final.status is MissionStatus.FAILED and final.last_error.code == "navigation_target_unreachable"
    assert world.moving_commands == 0 and final.navigation.phase is NavigationPhase.FAILED


def test_map_changed_between_check_and_reset_fails_without_motion():
    stack = Stack()
    stack.start()
    stack.maps.grid = arena_with_walls(revision=3)
    final = stack.run(max_ticks=50)
    assert final.status is MissionStatus.FAILED and final.last_error.code == "map_changed"
    assert stack.world.moving_commands == 0


def test_energy_shortfall_returns_early_and_never_completes():
    world = RecordingWorld(FakeClock(), SAMPLES, base_energy_per_m=7.0)  # реальный грунт дороже prior
    stack = Stack(world=world)
    stack.start(goal=target(Point(3.0, 2.0)))
    final = stack.run()
    assert final.status is MissionStatus.FAILED and final.last_error.code == "navigation_goal_not_reached"
    assert not final.navigation.target_reached and final.navigation.phase is NavigationPhase.FAILED
    assert world.finished and world.finish_success and world.battery > 0  # безопасный возврат состоялся
    titles = stack.titles(final.run_id)
    assert "Возврат по запасу энергии" in titles and "navigation_target_reached" not in titles
    assert titles.count("navigation_return_started") == 1


def test_target_blocked_mid_run_returns_without_target():
    stack = Stack()
    stack.start()
    stack.run(until=lambda snapshot: stack.world.linear > 0, max_ticks=200)
    stack.maps.grid = arena_with_walls((54, 44, 56, 46), revision=1)  # стены вокруг клетки цели (1.5, 1.5)
    final = stack.run()
    assert final.last_error.code == "navigation_goal_not_reached" and not final.navigation.target_reached
    assert "Возврат без достижения цели" in stack.titles(final.run_id)


def test_closed_path_waits_once_then_returns_without_target():
    stack = Stack()
    stack.start(goal=target(FAR_POINT))
    stack.run(until=lambda snapshot: stack.world.linear > 0, max_ticks=200)
    stack.maps.grid = arena_with_walls(RING_AROUND_FAR_POINT, revision=1)
    waiting = stack.run(until=lambda snapshot: "Путь к цели закрыт" in stack.titles(snapshot.run_id), max_ticks=500)
    assert waiting.status is MissionStatus.RUNNING
    for _ in range(40):  # 4 с ожидания: робот стоит, причина не повторяется каждый тик
        stack.world.advance()
        stack.service.tick()
        assert stack.world.linear == 0
    assert stack.titles(waiting.run_id).count("Путь к цели закрыт") == 1
    final = stack.run()
    assert final.last_error.code == "navigation_goal_not_reached" and stack.world.finish_success


def test_lost_observations_stop_robot_and_fail():
    stack = Stack()
    stack.start()
    stack.run(until=lambda snapshot: stack.world.linear > 0, max_ticks=200)
    stack.world.frozen = True
    final = stack.run(max_ticks=100)
    assert final.status is MissionStatus.FAILED and final.last_error.code == "observations_stale"
    assert stack.world.linear == 0 and final.navigation.phase is NavigationPhase.FAILED


def test_rejected_finish_is_not_completed():
    world = RecordingWorld(FakeClock(), SAMPLES)
    stack = Stack(world=world, judge=RejectingFinishJudge(world))
    stack.start()
    final = stack.run()
    assert final.navigation.target_reached
    assert final.status is MissionStatus.FAILED and final.last_error.code == "finish_rejected"


def test_unknown_finish_without_score_is_not_completed():
    world = RecordingWorld(FakeClock(), SAMPLES)
    stack = Stack(world=world, judge=TimeoutJudge(world))
    stack.start()
    final = stack.run()
    assert final.status is MissionStatus.FAILED and final.last_error.code == "finish_rejected"
    assert "неизвестен" in final.last_error.message


def test_unknown_finish_confirmed_by_public_score_completes():
    world = RecordingWorld(FakeClock(), SAMPLES)
    stack = Stack(world=world, judge=TimeoutJudge(world), score=world)
    stack.start()
    assert stack.run().status is MissionStatus.COMPLETED


def test_sample_sensor_anomaly_does_not_interrupt_navigation_route():
    stack = Stack()
    stack.start()
    stack.run(until=lambda snapshot: stack.world.linear > 0, max_ticks=200)
    stack.world.set_sensor("stuck")
    final = stack.run()
    assert final.status is MissionStatus.COMPLETED, final.last_error
    assert "Перепланирование" not in stack.titles(final.run_id)


def test_late_finish_reply_after_stop_and_new_reset_is_ignored():
    world = RecordingWorld(FakeClock(), SAMPLES)

    class DeferredOperation:
        reply = None

        def poll(self):
            return self.reply

    operation = DeferredOperation()

    def begin_finish():
        world.finish()
        return operation

    world.begin_finish = begin_finish
    stack = Stack(world=world)
    first = stack.start("first")
    stack.run(until=lambda snapshot: world.finished)
    assert stack.service.state().status is MissionStatus.RETURNING
    stack.service.stop_run("stop-first", first.run_id)
    stack.service.tick()
    second = stack.start("second")
    stack.world.advance()
    stack.service.tick()
    operation.reply = JudgeReply(True, "поздний ответ прошлого поколения")
    stack.world.advance()
    stack.service.tick()
    old = stack.service._runs[first.run_id].snapshot()
    assert old.status is MissionStatus.STOPPED and "Миссия завершена" not in stack.titles(first.run_id)
    current = stack.service.state()
    assert current.run_id == second.run_id and current.generation == first.generation + 1
    assert not current.navigation.target_reached and current.status is MissionStatus.RUNNING


def test_unknown_finish_outcome_enum_is_reconciled_not_retried():
    world = RecordingWorld(FakeClock(), SAMPLES)
    calls = []

    class CountingJudge(TimeoutJudge):
        def finish(self) -> JudgeReply:
            calls.append(1)
            return super().finish()

    stack = Stack(world=world, judge=CountingJudge(world))
    stack.start()
    stack.run()
    assert len(calls) == 1 and OperationOutcome.UNKNOWN.value == "unknown"


# ------------------------------------------- D1-live-1: возврат у стены


class WallAfterArrivalWorld(RecordingWorld):
    """После прибытия к цели lidar видит точку стены рядом с корпусом (как у стены арены вживую)."""

    def __init__(self, *args, offset: Point, follows_robot: bool = False, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.offset, self.follows_robot = offset, follows_robot
        self.wall: Point | None = None

    def latest(self):
        observation = super().latest()
        if self.wall is None and ((self.pose.x_m - TARGET.x_m) ** 2 + (self.pose.y_m - TARGET.y_m) ** 2) ** 0.5 < 0.12:
            self.wall = Point(self.pose.x_m + self.offset.x_m, self.pose.y_m + self.offset.y_m)
        if self.wall is None:
            return observation
        wall = (Point(self.pose.x_m + self.offset.x_m, self.pose.y_m + self.offset.y_m)
                if self.follows_robot else self.wall)
        return replace(observation, scan_obstacles=(wall,))


def test_rotation_guard_uses_swept_footprint_not_braking_clearance():
    from application.navigation_service import NavigationService
    from domain.energy import TerrainEstimator

    navigation = NavigationService(build_arena(), TerrainEstimator(), SETTINGS)
    pose = Pose(1.5, 1.5, 0.0)
    for distance, rotation_blocked in ((0.18, False), (0.13, True)):
        navigation.observe_dynamic_obstacles((Point(1.5 + distance, 1.5),), now_s=10.0)
        assert navigation.command_blocked(pose, 0.0, 1.0, 0.05, 10.0) is rotation_blocked, distance
        assert navigation.command_blocked(pose, 0.15, 0.0, 0.05, 10.0)  # вперёд на стену — всегда стоп


def test_wall_in_front_after_arrival_robot_turns_and_completes():
    world = WallAfterArrivalWorld(FakeClock(), SAMPLES, offset=Point(0.18, 0.0))
    stack = Stack(world=world)
    stack.start()
    final = stack.run(max_ticks=3000)
    assert world.wall is not None
    assert final.status is MissionStatus.COMPLETED, final.last_error
    assert stack.titles(final.run_id).count("Остановка перед препятствием") <= 1


def test_permanently_blocked_return_ends_bounded_with_zero_velocity():
    world = WallAfterArrivalWorld(FakeClock(), SAMPLES, offset=Point(0.0, 0.12), follows_robot=True)
    stack = Stack(world=world)
    stack.start()
    final = stack.run(max_ticks=1500)  # 150 с симуляции: без исправления цикл бесконечен
    assert final.status is MissionStatus.FAILED and final.last_error.code in ("stuck_returning", "no_route_home")
    assert final.navigation.target_reached and stack.world.linear == 0 and stack.world.angular == 0
    titles = stack.titles(final.run_id)
    assert len(titles) < 40, titles  # раньше журнал рос на ~10 записей в секунду
    assert titles.count("Подцель: return") <= 4

