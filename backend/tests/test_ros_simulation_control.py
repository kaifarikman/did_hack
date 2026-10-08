import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from adapters.ros.simulation_control import SupervisorSimulationControl
from application.ports import MapMode, ResetRequest
import pytest


def run_reset(response=None, request=None):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            received.append((self.path, json.loads(self.rfile.read(length))))
            self.send_response(200)
            payload = json.dumps(response if response is not None else {
                "state": "ready", "seed": 12, "scenario": "hard", "map_mode": "static", "robots": 1,
                "generation": 7,
            }).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    cache_resets = []
    generations = []
    control = SupervisorSimulationControl(f"http://127.0.0.1:{server.server_port}",
                                          lambda: cache_resets.append(1), timeout_s=5,
                                          set_generation=generations.append)
    reset_request = request or ResetRequest("hard", 12, generation=7)
    ack = control.reset(reset_request)
    server.server_close()
    return received, cache_resets, generations, ack


def test_current_generation_reads_ready_supervisor_status(monkeypatch):
    from adapters.ros.simulation_control import urllib

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def read(self):
            return json.dumps({"state": "ready", "generation": 41}).encode()

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_args, **_kwargs: Response())
    control = SupervisorSimulationControl("http://supervisor", lambda: None)
    assert control.current_generation() == 41


@pytest.mark.parametrize("body", [
    {"state": "starting", "generation": 41},
    {"state": "ready", "generation": True},
    {"state": "ready", "generation": -1},
])
def test_current_generation_rejects_unconfirmed_supervisor_state(monkeypatch, body):
    from adapters.ros.simulation_control import urllib

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def read(self): return json.dumps(body).encode()

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_args, **_kwargs: Response())
    with pytest.raises(RuntimeError, match="generation"):
        SupervisorSimulationControl("http://supervisor", lambda: None).current_generation()


def test_reset_sends_parameters_and_confirms_applied_generation():
    received, cache_resets, generations, ack = run_reset()
    assert received == [("/reset", {"seed": 12, "scenario": "hard", "map_mode": "static", "robots": 1,
                                      "generation": 7})]
    assert len(cache_resets) == 2
    assert generations == [7, 7]
    assert ack.matches(ResetRequest("hard", 12, generation=7))


def test_reset_can_request_slam_and_two_robots():
    request = ResetRequest("medium", 21, generation=9, map_mode=MapMode.SLAM,
                           robot_ids=("robot_1", "robot_2"))
    response = {"state": "ready", "seed": 21, "scenario": "medium", "map_mode": "slam", "robots": 2}
    response["generation"] = 9
    received, cache_resets, generations, ack = run_reset(response, request)
    assert received == [("/reset", {"seed": 21, "scenario": "medium", "map_mode": "slam", "robots": 2,
                                      "generation": 9})]
    assert len(cache_resets) == 2
    assert generations == [9, 9]
    assert ack.matches(request)


@pytest.mark.parametrize("response", [
    {},
    {"state": "failed", "seed": 12, "scenario": "hard", "map_mode": "static", "robots": 1},
    {"state": "ready", "seed": 11, "scenario": "hard", "map_mode": "static", "robots": 1},
    {"state": "ready", "seed": 12, "scenario": "hard", "map_mode": "static", "robots": 1,
     "generation": 6},
])
def test_reset_rejects_unconfirmed_or_mismatched_supervisor_response(response):
    with pytest.raises(RuntimeError, match="supervisor"):
        run_reset(response)
