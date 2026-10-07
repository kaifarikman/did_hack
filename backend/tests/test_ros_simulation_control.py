import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from adapters.ros.simulation_control import SupervisorSimulationControl


def run_reset(map_mode=None):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            received.append((self.path, json.loads(self.rfile.read(length))))
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    cache_resets = []
    extra = {"map_mode": map_mode} if map_mode else {}
    control = SupervisorSimulationControl(f"http://127.0.0.1:{server.server_port}",
                                          lambda: cache_resets.append(1), timeout_s=5, **extra)
    control.reset("hard", 12)
    server.server_close()
    assert len(cache_resets) == 2
    return received


def test_reset_sends_scenario_and_seed_to_supervisor():
    assert run_reset() == [("/reset", {"seed": 12, "scenario": "hard", "map_mode": "static"})]


def test_reset_can_request_slam_profile():
    assert run_reset("slam") == [("/reset", {"seed": 12, "scenario": "hard", "map_mode": "slam"})]
