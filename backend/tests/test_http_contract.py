import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adapters.http.app import create_app
from fakes import FakeClock, SimWorld
from domain.geometry import Point
from harness import make_service

EXAMPLES = Path(__file__).resolve().parents[2] / "context" / "mvp" / "examples"
SAMPLES = [Point(1.5, 1.0), Point(-1.0, 2.0), Point(2.5, -1.5)]


def example(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


@pytest.fixture
def stack():
    clock = FakeClock()
    world = SimWorld(clock, SAMPLES)
    service, environment, maps, journal = make_service(world, clock)
    client = TestClient(create_app(service, environment, maps), raise_server_exceptions=False)
    return client, service, world, environment, maps


def assert_same_shape(actual, expected, path="$"):
    """Те же ключи и типы, что в примере; null допускается на месте любого значения."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), path
        assert set(actual) == set(expected), f"{path}: {set(actual) ^ set(expected)}"
        for key in expected:
            assert_same_shape(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list) and expected:
        for item in actual:
            assert_same_shape(item, expected[0], path + "[]")
    elif expected is not None and actual is not None and not isinstance(expected, list):
        assert isinstance(actual, (int, float)) == isinstance(expected, (int, float)), path
        assert isinstance(actual, str) == isinstance(expected, str), path


def start(client, request_id="req-1", seed=42, scenario="easy"):
    return client.post("/api/v1/runs", json={"request_id": request_id, "scenario": scenario, "seed": seed})


def test_idle_state_matches_example_exactly(stack):
    client, *_ = stack
    body = client.get("/api/v1/state").json()
    expected = example("state-idle.json")
    expected["map_id"] = "test-arena"
    assert body == expected


def test_running_state_has_same_fields_and_types_as_example(stack):
    client, service, world, *_ = stack
    run = start(client).json()
    for _ in range(40):
        world.advance()
        service.tick()
    body = client.get("/api/v1/state").json()
    assert body["status"] == "running" and body["run_id"] == run["run_id"]
    assert_same_shape(body, example("state-running.json"))
    assert body["current_goal"] is not None and set(body["current_goal"]) == {"kind", "target", "reason"}


def test_health_map_and_error_shape(stack):
    client, _, _, environment, maps = stack
    assert client.get("/api/v1/health").json() == {
        "status": "ready", "ros_connected": True, "judge_mode": "local", "llm_available": False}
    body = client.get("/api/v1/map").json()
    assert set(body) == set(example("map.json")) and len(body["cells"]) == body["width"] * body["height"]
    assert body["origin"].keys() == example("map.json")["origin"].keys()
    environment.ros = False
    assert client.get("/api/v1/health").json()["status"] == "starting"
    error = start(client)
    assert error.status_code == 503
    assert error.json() == {"error": {**example("error.json")["error"], "message": error.json()["error"]["message"]}}
    maps.grid = None
    assert client.get("/api/v1/map").status_code == 503


def test_start_is_202_conflicts_and_validation(stack):
    client, service, *_ = stack
    first = start(client)
    assert first.status_code == 202 and first.json()["status"] == "starting" and first.json()["revision"] >= 0
    other = start(client, request_id="req-2")
    assert other.status_code == 409 and other.json()["error"]["code"] == "run_conflict"
    assert start(client, request_id="req-3", scenario="hard").status_code == 422
    assert client.post("/api/v1/runs", json={"request_id": "x", "scenario": "easy"}).status_code == 422
    assert client.post("/api/v1/runs", json={"request_id": "x", "scenario": "easy", "seed": "1"}).status_code == 422
    assert client.post("/api/v1/runs", json={"request_id": 1, "scenario": "easy", "seed": 1}).status_code == 422


def test_request_id_dedup_same_body_replays_and_different_body_conflicts(stack):
    client, service, *_ = stack
    first = start(client, "dup", seed=7).json()
    again = start(client, "dup", seed=7)
    assert again.status_code == 202 and again.json()["run_id"] == first["run_id"]
    assert len(service._missions) == 1
    clash = start(client, "dup", seed=8)
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "run_conflict"
    stop = client.post(f"/api/v1/runs/{first['run_id']}/stop", json={"request_id": "dup"})
    assert stop.status_code == 409  # тот же ID с другим телом (другая команда)


def test_stop_flow_unknown_old_and_terminal_runs(stack):
    client, service, world, *_ = stack
    run_id = start(client).json()["run_id"]
    assert client.post("/api/v1/runs/nope/stop", json={"request_id": "s0"}).status_code == 404
    stopped = client.post(f"/api/v1/runs/{run_id}/stop", json={"request_id": "s1"})
    assert stopped.status_code == 202 and stopped.json()["status"] == "stopping"
    assert client.post(f"/api/v1/runs/{run_id}/stop", json={"request_id": "s1"}).json()["status"] == "stopping"
    service.tick()
    assert client.get("/api/v1/state").json()["status"] == "stopped"
    terminal = client.post(f"/api/v1/runs/{run_id}/stop", json={"request_id": "s2"})
    assert terminal.status_code == 202 and terminal.json()["status"] == "stopped"
    second = start(client, "again").json()
    assert second["run_id"] != run_id
    old = client.post(f"/api/v1/runs/{run_id}/stop", json={"request_id": "s3"})
    assert old.status_code == 409


def test_start_stop_start_resets_world_and_memory(stack):
    client, service, world, *_ = stack
    first = start(client).json()["run_id"]
    for _ in range(50):
        world.advance()
        service.tick()
    client.post(f"/api/v1/runs/{first}/stop", json={"request_id": "s"})
    service.tick()
    second = start(client, "r2").json()
    for _ in range(3):
        world.advance()
        service.tick()
    state = client.get("/api/v1/state").json()
    assert state["run_id"] == second["run_id"] != first and world.reset_calls == 2
    assert state["trajectory"][0] == {"position_x_m": -2.0, "position_y_m": -0.5}
    assert len(state["trajectory"]) < 5  # путь предыдущего прогона не перенесён
    assert client.get(f"/api/v1/runs/{first}/journal").status_code == 200  # старый журнал читается


def test_successful_run_then_new_run_both_complete(stack):
    client, service, world, *_ = stack
    for index in range(2):
        run_id = start(client, f"run-{index}", seed=1).json()["run_id"]
        for _ in range(30000):
            world.advance()
            service.tick()
            if client.get("/api/v1/state").json()["status"] in ("completed", "failed", "stopped"):
                break
        state = client.get("/api/v1/state").json()
        assert state["status"] == "completed", state["last_error"]
        assert state["samples_collected"] >= 1 and state["battery_remaining"] > 0


def test_journal_shape_pagination_and_errors(stack):
    client, service, world, *_ = stack
    run_id = start(client).json()["run_id"]
    for _ in range(60):
        world.advance()
        service.tick()
    full = client.get(f"/api/v1/runs/{run_id}/journal").json()
    assert set(full) == set(example("journal.json")) and full["entries"]
    assert_same_shape(full["entries"][0], example("journal.json")["entries"][0])
    sequences = [e["sequence"] for e in full["entries"]]
    assert sequences == sorted(set(sequences)) and sequences[0] == 1
    assert full["next_sequence"] == sequences[-1] and full["has_more"] is False
    page = client.get(f"/api/v1/runs/{run_id}/journal", params={"after_sequence": 0, "limit": 1}).json()
    assert len(page["entries"]) == 1 and page["has_more"] == (len(sequences) > 1)
    empty = client.get(f"/api/v1/runs/{run_id}/journal", params={"after_sequence": 10_000}).json()
    assert empty["entries"] == [] and empty["next_sequence"] == 10_000 and empty["has_more"] is False
    for params in ({"limit": 0}, {"limit": 201}, {"after_sequence": -1}, {"limit": "x"}):
        response = client.get(f"/api/v1/runs/{run_id}/journal", params=params)
        assert response.status_code == 422 and "error" in response.json()
    assert client.get("/api/v1/runs/unknown/journal").status_code == 404


def test_journal_does_not_expose_hidden_sample_coordinates(stack):
    client, service, world, *_ = stack
    run_id = start(client).json()["run_id"]
    for _ in range(3000):
        world.advance()
        service.tick()
    text = json.dumps(client.get(f"/api/v1/runs/{run_id}/journal?limit=200").json())
    for sample in SAMPLES:
        assert f"{sample.x_m:.2f}, {sample.y_m:.2f}" not in text


def test_internal_error_hides_traceback(stack):
    client, service, *_ = stack
    service.state = lambda: (_ for _ in ()).throw(RuntimeError("секрет в traceback"))
    response = client.get("/api/v1/state")
    assert response.status_code == 503
    assert "секрет" not in response.text and response.json()["error"]["retryable"] is True
