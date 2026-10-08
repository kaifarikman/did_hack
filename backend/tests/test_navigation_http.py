"""HTTP-контракт D1: команда navigation, ошибки, идемпотентность и state 1.4.

Снимки фаз сверяются с fixtures `tests/fixtures/defense/`. Перегенерация после осознанного
изменения контракта: `DEFENSE_FIXTURES_WRITE=1 pytest tests/test_navigation_http.py`.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adapters.http.app import create_app
from domain.geometry import Point
from fakes import FakeClock, FakeEnvironment, SimWorld
from harness import make_service
from test_http_contract import assert_same_shape

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "defense"
WRITE_FIXTURES = os.environ.get("DEFENSE_FIXTURES_WRITE") == "1"
MAP_ID = "test-arena"


@pytest.fixture
def stack():
    clock = FakeClock()
    world = SimWorld(clock, [Point(1.5, 1.0)])
    service, environment, maps, journal = make_service(
        world, clock, environment=FakeEnvironment(scenarios=("easy", "medium", "hard")))
    client = TestClient(create_app(service, environment, maps), raise_server_exceptions=False)
    return client, service, world, environment, maps


def body(request_id="nav-1", x=1.5, y=1.5, map_id=MAP_ID, **overrides) -> dict:
    return {
        "request_id": request_id, "scenario": "easy", "seed": 7, "map_mode": "static", "robot_count": 1,
        "task_type": "navigation",
        "navigation_target": {"position_x_m": x, "position_y_m": y, "map_id": map_id},
        **overrides,
    }


def post(client, payload: dict):
    return client.post("/api/v1/runs", json=payload)


def error_of(response) -> tuple[int, str, bool]:
    error = response.json()["error"]
    return response.status_code, error["code"], error["retryable"]


def matches_fixture(name: str, actual: dict) -> None:
    path = FIXTURES / name
    if WRITE_FIXTURES:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    expected = json.loads(path.read_text(encoding="utf-8"))
    assert_same_shape(actual, expected)
    for key in ("schema_version", "task_type", "status"):
        assert actual[key] == expected[key], key
    for key in ("target", "phase", "target_reached", "arrival_tolerance_m"):
        assert actual["navigation"][key] == expected["navigation"][key], key


def run_until(client, service, world, predicate, max_ticks=20000) -> dict:
    for _ in range(max_ticks):
        world.advance()
        service.tick()
        state = client.get("/api/v1/state").json()
        if predicate(state) or state["status"] in ("completed", "failed", "stopped"):
            return state
    return client.get("/api/v1/state").json()


def test_health_announces_navigation(stack):
    client, *_ = stack
    assert client.get("/api/v1/health").json()["supported_task_types"] == ["research", "navigation"]


def test_navigation_start_returns_202_pending_snapshot(stack):
    client, *_ = stack
    map_id = client.get("/api/v1/map").json()["map_id"]
    response = post(client, body(map_id=map_id))
    assert response.status_code == 202
    state = response.json()
    assert state["schema_version"] == "1.4" and state["task_type"] == "navigation"
    assert state["status"] == "starting" and state["planner_mode"] == "fallback"
    assert state["navigation"] == {
        "target": {"position_x_m": 1.5, "position_y_m": 1.5, "map_id": MAP_ID},
        "phase": "pending", "target_reached": False, "target_reached_at_s": None, "arrival_tolerance_m": 0.12,
    }
    matches_fixture("state-navigation-pending.json", state)


def test_full_navigation_through_http_phases_and_journal(stack):
    client, service, world, *_ = stack
    run_id = post(client, body()).json()["run_id"]
    moving = run_until(client, service, world, lambda state: state["planned_path"] and state["status"] == "running")
    assert moving["navigation"]["phase"] == "moving_to_target" and moving["current_goal"]["kind"] == "explore"
    assert moving["current_goal"]["target"] == {"position_x_m": 1.5, "position_y_m": 1.5}
    matches_fixture("state-navigation-moving.json", moving)
    returning = run_until(client, service, world, lambda state: state["status"] == "returning")
    assert returning["navigation"]["phase"] == "returning" and returning["navigation"]["target_reached"] is True
    assert returning["navigation"]["target_reached_at_s"] is not None
    assert returning["current_goal"]["kind"] == "return"  # подцель возврата отдельно от цели пользователя
    assert returning["navigation"]["target"]["position_x_m"] == 1.5
    matches_fixture("state-navigation-returning.json", returning)
    final = run_until(client, service, world, lambda state: False)
    assert final["status"] == "completed" and final["navigation"]["phase"] == "finished"
    assert final["current_goal"] is None and final["samples_collected"] == 0
    matches_fixture("state-navigation-completed.json", final)
    titles = [entry["title"] for entry in client.get(f"/api/v1/runs/{run_id}/journal?limit=200").json()["entries"]]
    for name in ("navigation_target_set", "navigation_target_reached", "navigation_return_started"):
        assert titles.count(name) == 1


def test_stop_during_navigation_via_http(stack):
    client, service, world, *_ = stack
    run_id = post(client, body()).json()["run_id"]
    run_until(client, service, world, lambda state: world.linear > 0)
    stopping = client.post(f"/api/v1/runs/{run_id}/stop", json={"request_id": "stop-nav"})
    assert stopping.status_code == 202 and stopping.json()["navigation"]["phase"] == "moving_to_target"
    service.tick()
    state = client.get("/api/v1/state").json()
    assert state["status"] == "stopped" and state["navigation"]["phase"] == "stopped"
    assert state["navigation"]["target_reached"] is False and world.linear == 0
    matches_fixture("state-navigation-stopped.json", state)


@pytest.mark.parametrize(("payload", "expected"), [
    (body(task_type="research"), (422, "invalid_request", False)),
    (body(navigation_target=None), (422, "invalid_request", False)),
    (body(x="1.5"), (422, "invalid_request", False)),
    (body(x=True), (422, "invalid_request", False)),
    (body(navigation_target={"position_x_m": 1.5, "position_y_m": 1.5, "map_id": MAP_ID, "z": 0}),
     (422, "invalid_request", False)),
    (body(task_type="patrol"), (422, "invalid_request", False)),
    (body(x=0.0, y=0.5), (422, "navigation_target_unreachable", False)),  # столб
    (body(x=40.0), (422, "navigation_target_unreachable", False)),
    (body(map_id="test-arena#r9"), (409, "map_changed", False)),
    (body(scenario="medium"), (409, "scenario_unavailable", False)),
    (body(robot_count=2), (409, "scenario_unavailable", False)),
])
def test_navigation_errors_use_existing_envelope(stack, payload, expected):
    client, _, world, *_ = stack
    response = post(client, payload)
    assert error_of(response) == expected
    assert world.reset_calls == 0 and client.get("/api/v1/state").json()["status"] == "idle"


def test_non_finite_coordinates_are_invalid_request(stack):
    client, *_ = stack
    raw = json.dumps(body()).replace('"position_x_m": 1.5', '"position_x_m": NaN')
    response = client.post("/api/v1/runs", content=raw, headers={"content-type": "application/json"})
    assert error_of(response) == (422, "invalid_request", False)


def test_environment_not_ready_is_retryable(stack):
    client, _, _, environment, _ = stack
    environment.ros = False
    assert error_of(post(client, body())) == (503, "environment_not_ready", True)


def test_idempotent_replay_and_conflicting_body(stack):
    client, service, world, *_ = stack
    first = post(client, body("same"))
    world.advance()
    service.tick()
    replay = post(client, body("same"))
    assert replay.status_code == 202 and replay.json()["run_id"] == first.json()["run_id"]
    assert world.reset_calls == 1
    assert error_of(post(client, body("same", x=1.0))) == (409, "run_conflict", False)
    assert error_of(post(client, body("same", task_type="research", navigation_target=None))) == \
        (409, "run_conflict", False)
    assert error_of(post(client, body("fresh"))) == (409, "run_conflict", False)  # активный прогон


def test_failed_navigation_snapshot_shape(stack):
    client, service, world, *_ = stack
    world.battery_initial = 8.0  # после сброса батареи меньше, чем обещал профиль
    post(client, body())
    final = run_until(client, service, world, lambda state: False, max_ticks=100)
    assert final["status"] == "failed" and final["navigation"]["phase"] == "failed"
    assert final["last_error"]["code"] == "navigation_target_unreachable"
    matches_fixture("state-navigation-failed.json", final)
