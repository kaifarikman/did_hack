"""Два робота: брони, обмен знаниями без дублей, разъезд, потеря партнёра, исходы команды."""
from domain.coordination import KnowledgeExchange, PartnerPose, ReservationBook, SharedSignal, must_yield
from domain.geometry import Point, Pose, distance_m
from domain.mission import MissionStatus
from fakes import FakeClock, TeamWorld
from harness import make_team_service

STARTS = {"robot_1": Pose(-2.0, -0.5, 0.0), "robot_2": Pose(-2.0, 0.4, 0.0)}
SAMPLES = [Point(-0.5, -1.6), Point(0.8, 1.4), Point(1.8, -0.4)]


def run_team(service, team, ticks=40000, on_tick=None):
    for tick in range(ticks):
        team.advance()
        service.tick()
        if on_tick:
            on_tick(tick)
        if service.state().status.is_terminal:
            return tick
    return ticks


def test_reservation_blocks_partner_and_expires():
    book = ReservationBook(radius_m=0.8, ttl_s=10.0)
    assert book.claim("robot_1", Point(1, 1), now_s=0.0)
    assert not book.claim("robot_2", Point(1.3, 1.0), now_s=1.0)
    assert book.claim("robot_2", Point(3, 3), now_s=1.0)
    assert book.holder_near(Point(1.2, 1), "robot_2", now_s=5.0).robot_id == "robot_1"
    assert book.holder_near(Point(1.2, 1), "robot_2", now_s=11.0) is None  # бронь истекла


def test_repeated_message_does_not_add_evidence():
    exchange = KnowledgeExchange()
    item = SharedSignal("robot_1", 7, Point(0, 0), 0.5, 1.0)
    assert exchange.publish_signal(item) and not exchange.publish_signal(item)
    fresh, _ = exchange.signals_after(0, exclude_robot="robot_2")
    assert len(fresh) == 1 and exchange.duplicates_ignored == 1


def test_lower_priority_yields_and_stale_partner_pose_is_treated_cautiously():
    order = ("robot_1", "robot_2")
    near = PartnerPose("robot_1", Point(0.3, 0), 0.0, received_s=10.0)
    assert must_yield("robot_2", Point(0, 0), near, now_s=10.5, priority=order)
    assert not must_yield("robot_1", Point(0, 0), PartnerPose("robot_2", Point(0.3, 0), 0, 10.0), 10.5, order)
    stale = PartnerPose("robot_2", Point(0.3, 0), 0.0, received_s=0.0)
    assert must_yield("robot_1", Point(0, 0), stale, now_s=10.0, priority=order)


def test_coordinated_team_collects_without_double_count_and_both_return():
    clock = FakeClock()
    team = TeamWorld(clock, SAMPLES, STARTS, seed=2)
    service, journal, controllers = make_team_service(team, clock)
    snapshot = service.start_run("t", "easy", 2, robot_count=2)
    run_id = snapshot.run_id
    conflicts = []

    def watch(_tick):
        goals = [c._goal for c in controllers.values()]
        if all(g is not None and g.target is not None and g.kind.value != "return" for g in goals):
            if distance_m(goals[0].target, goals[1].target) < 0.8:
                conflicts.append((goals[0].target, goals[1].target))

    run_team(service, team, on_tick=watch)
    state = service.state()
    assert state.team is not None and state.team.outcome == "success", [r.last_error for r in state.team.robots]
    assert state.status is MissionStatus.COMPLETED
    assert state.samples_collected == team.total_collected >= 1
    assert all(robot.status is MissionStatus.COMPLETED for robot in state.team.robots)
    assert not conflicts, "две цели одновременно в одной забронированной области"
    authors = {entry.draft.robot_id for entry in journal.tail(run_id, 10000)}
    assert authors == {"robot_1", "robot_2"}
    assert team.reset_calls == 1  # общий сброс один раз на поколение


def test_lost_partner_releases_tasks_and_team_reports_partial_result():
    clock = FakeClock()
    team = TeamWorld(clock, SAMPLES, STARTS, seed=2)
    service, journal, _ = make_team_service(team, clock)
    run_id = service.start_run("t", "easy", 2, robot_count=2).run_id

    def lose(tick):
        if tick == 300:
            team.robots["robot_2"].alive = False

    run_team(service, team, on_tick=lose)
    state = service.state()
    robots = {robot.robot_id: robot for robot in state.team.robots}
    assert robots["robot_2"].status is MissionStatus.FAILED
    assert robots["robot_1"].status is MissionStatus.COMPLETED
    titles = [entry.draft.title for entry in journal.tail(run_id, 10000) if entry.draft.robot_id == "robot_1"]
    assert "Партнёр потерян" in titles
    assert state.team.lost_robots == ("robot_2",)
    expected = "partial" if state.samples_collected > 0 else "failed"
    assert state.team.outcome == expected and state.status is MissionStatus.FAILED  # потеря не маскируется


def test_head_on_meeting_resolves_by_yield_and_bounded_wait():
    from domain.subgoals import GoalKind, Subgoal
    clock = FakeClock()
    starts = {"robot_1": Pose(-2.0, -1.5, 0.0), "robot_2": Pose(1.0, -1.5, 3.14159)}
    team = TeamWorld(clock, [Point(3.0, 2.5)], starts, seed=1)
    service, journal, controllers = make_team_service(team, clock)
    run_id = service.start_run("t", "easy", 3, robot_count=2).run_id
    team.advance()
    service.tick()
    from fakes import ScriptedPlanner
    from application.plan_execution import PlanExecutor
    for robot_id, target in (("robot_1", Point(1.0, -1.5)), ("robot_2", Point(-2.0, -1.4))):
        controller = controllers[robot_id]
        controller._plans._planner = ScriptedPlanner([Subgoal(GoalKind.EXPLORE, target, "встречный", "llm")])
    for _ in range(600):
        team.advance()
        service.tick()
    titles = [(e.draft.robot_id, e.draft.title) for e in journal.tail(run_id, 10000)]
    assert ("robot_2", "Уступаем дорогу") in titles
    assert ("robot_1", "Уступаем дорогу") not in titles


def test_team_snapshot_matches_shared_fixture_shape():
    import json
    from pathlib import Path
    from adapters.http.serialization import snapshot_json
    from test_http_contract import assert_same_shape
    clock = FakeClock()
    team = TeamWorld(clock, SAMPLES, STARTS, seed=2)
    service, _, _ = make_team_service(team, clock)
    service.start_run("t", "easy", 2, robot_count=2)
    for _ in range(200):
        team.advance()
        service.tick()
    example = json.loads((Path(__file__).parents[2] / "context/mvp/examples/state-team-partial.json").read_text())
    body = snapshot_json(service.state())
    assert set(body["team"]) == set(example["team"])
    assert_same_shape(body["team"]["robots"][0], example["team"]["robots"][0])
