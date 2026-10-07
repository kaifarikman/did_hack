"""Исполнение многошагового плана: проверка шагов, устаревшие ответы, лимиты запросов."""
from dataclasses import replace

from domain.geometry import Point
from domain.mission import MissionStatus
from domain.plans import MissionPlan, PlanStep, StepStatus
from domain.subgoals import GoalKind, Subgoal
from fakes import FakeClock, ScriptedPlanner, SimWorld
from harness import SETTINGS, make_controller, run_ticks

SAMPLES = [Point(3.0, 2.5)]


def plan_of(*goals, plan_id="llm-plan"):
    return MissionPlan(plan_id, "", 0, 0, tuple(PlanStep(goal, ("#1",), "если сигнал вырастет") for goal in goals),
                       "проверка порядка", ("батареи достаточно",), "llm")


def explore(x, y):
    return Subgoal(GoalKind.EXPLORE, Point(x, y), f"к ({x}, {y})", "llm")


def titles(journal, mission):
    return [entry.draft for entry in journal.tail(mission.run_id, 5000)]


def test_steps_execute_in_order_with_plan_id_and_statuses():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    planner = ScriptedPlanner([plan_of(explore(-1.0, -0.5), explore(-1.0, 0.5))])
    controller, mission, journal = make_controller(world, clock, planner=planner)
    for _ in range(600):
        world.advance()
        controller.tick()
        snapshot = mission.snapshot()
        if snapshot.plan is not None and snapshot.plan_statuses == (StepStatus.DONE, StepStatus.DONE):
            break
    snapshot = mission.snapshot()
    assert snapshot.plan.plan_id == "plan-1" and snapshot.plan.source == "llm"
    assert snapshot.plan_statuses == (StepStatus.DONE, StepStatus.DONE)
    drafts = titles(journal, mission)
    received = next(d for d in drafts if d.title == "План получен")
    assert received.plan_id == "plan-1" and "#1" in received.evidence and "батареи достаточно" in received.detail
    routes = [d for d in drafts if d.title == "Подцель: explore"]
    assert [d.plan_id for d in routes[:2]] == ["plan-1", "plan-1"]


def test_step_inside_wall_is_rejected_and_next_step_runs():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    wall = explore(0.0, 0.5)  # столб арены
    planner = ScriptedPlanner([plan_of(wall, explore(-1.0, -0.5))])
    controller, mission, journal = make_controller(world, clock, planner=planner)
    for _ in range(3):
        world.advance()
        controller.tick()
    snapshot = mission.snapshot()
    assert snapshot.plan_statuses == (StepStatus.REJECTED, StepStatus.ACTIVE)
    assert snapshot.current_goal.target == Point(-1.0, -0.5)
    assert any(d.title == "Подцель отклонена исполнителем" and "Шаг 1" in d.detail for d in titles(journal, mission))


def test_plan_built_for_old_model_version_is_dropped():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    holder = {}

    def model_changes_during_request():
        holder["controller"]._plans.invalidate("тестовое изменение модели")

    planner = ScriptedPlanner([plan_of(explore(-1.0, -0.5)), plan_of(explore(-1.0, 0.5))],
                              on_call=lambda: holder.pop("trigger", lambda: None)())
    controller, mission, journal = make_controller(world, clock, planner=planner)
    holder["controller"] = controller
    holder["trigger"] = model_changes_during_request
    for _ in range(5):
        world.advance()
        controller.tick()
    drafts = titles(journal, mission)
    assert any(d.title == "План отброшен как устаревший" for d in drafts)
    assert mission.snapshot().current_goal.target == Point(-1.0, 0.5)  # исполняется только свежий план


def test_request_budget_switches_to_visible_fallback():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    settings = replace(SETTINGS, max_planner_requests=2, min_planner_interval_s=0.0)
    planner = ScriptedPlanner([explore(-1.6, -0.5), explore(-1.2, -0.5), explore(-0.8, -0.5)])
    controller, mission, journal = make_controller(world, clock, planner=planner, settings=settings,
                                                   planner_rate_limited=True)
    for _ in range(400):
        world.advance()
        controller.tick()
    assert planner.calls == 2
    assert any("исчерпан лимит запросов" in (d.detail or "") for d in titles(journal, mission))


def test_min_interval_delays_requests_instead_of_switching_to_fallback():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    settings = replace(SETTINGS, min_planner_interval_s=5.0)
    planner = ScriptedPlanner([Subgoal(GoalKind.COLLECT, None, "сбор", "llm")] * 3)
    controller, mission, journal = make_controller(world, clock, planner=planner, settings=settings,
                                                   planner_rate_limited=True)
    for _ in range(20):  # 2 с: второй запрос ещё не разрешён
        world.advance()
        controller.tick()
    assert planner.calls == 1 and world.linear == 0


def test_completed_run_has_no_current_goal_or_planned_path():
    clock = FakeClock()
    world = SimWorld(clock, [Point(-1.0, -0.5)])
    controller, mission, _ = make_controller(world, clock)
    run_ticks(controller, world, mission)
    snapshot = mission.snapshot()
    assert snapshot.status is MissionStatus.COMPLETED
    assert snapshot.current_goal is None and snapshot.planned_path == ()
