"""Супервизор симуляции: запускает Gazebo + судью и перезапускает их под новый seed.

Reset реализован как рестарт процессов: одометрия снова начинается с нуля у базы,
поэтому преобразование world = (-2.0, -0.5) + odom остаётся верным.

HTTP (внутренний, только сеть Compose):
  GET  /status        -> {"state": "starting|ready|failed", "seed": int|null, "scenario": str|null}
  POST /reset {"seed": int, "scenario": "easy|medium|hard", "map_mode": "static|slam"} -> блокируется до готовности или таймаута; 200/500
"""
import json
import os
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROS_SETUP = "/opt/ros/jazzy/setup.bash"
SIM_DIR = os.environ.get("SIMULATION_DIR", "/workspace/simulation")
READY_TIMEOUT_S = float(os.environ.get("SIM_READY_TIMEOUT_S", "120"))
PORT = int(os.environ.get("SUPERVISOR_PORT", "7000"))
SCENARIOS = ("easy", "medium", "hard")
MAP_MODES = ("static", "slam")
DEFAULT_MAP_MODE = "static"
DEFAULT_SCENARIO = "easy"


def ros_shell(command: str) -> list:
    return ["bash", "-c", f"source {ROS_SETUP} && {command}"]


class Simulation:
    def __init__(self):
        self._lock = threading.Lock()
        self._processes = []
        self.state = "stopped"
        self.seed = None
        self.scenario = None
        self.map_mode = None

    def restart(self, seed: int, scenario: str = DEFAULT_SCENARIO, map_mode: str = DEFAULT_MAP_MODE):
        with self._lock:
            self.state, self.seed, self.scenario, self.map_mode = "starting", seed, scenario, map_mode
            self._stop_processes()
            self._start_processes(seed, scenario, map_mode)
            self.state = "ready" if self._wait_ready() else "failed"
            return self.state == "ready"

    def _start_processes(self, seed: int, scenario: str, map_mode: str):
        commands = [
            f"exec ros2 launch {SIM_DIR}/launch/headless_world.launch.py",
            f"exec python3 {SIM_DIR}/scripts/cmd_vel_guard.py",
            f"cd {SIM_DIR}/judge && exec python3 -m did_judge.ros_node --ros-args "
            f"-p seed:={seed} -p config_path:={SIM_DIR}/judge/config/local_{scenario}.json",
        ]
        if map_mode == "slam":
            commands.append(f"exec ros2 launch slam_toolbox online_async_launch.py use_sim_time:=true "
                            f"slam_params_file:={SIM_DIR}/config/slam_params.yaml")
        for index, command in enumerate(commands):
            self._processes.append(subprocess.Popen(ros_shell(command), start_new_session=True))
            if index == 0:
                time.sleep(2.0)  # судья стартует после сервера, чтобы /clock и /odom уже шли

    def _stop_processes(self):
        for process in self._processes:
            self._signal_group(process, signal.SIGINT)
        deadline = time.monotonic() + 10.0
        for process in self._processes:
            try:
                process.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                self._signal_group(process, signal.SIGKILL)
                process.wait()
        self._processes = []
        subprocess.run(["bash", "-c", "pkill -9 -f 'gz sim' || true; pkill -9 -f ruby || true"],
                       check=False)

    @staticmethod
    def _signal_group(process, sig):
        try:
            os.killpg(os.getpgid(process.pid), sig)
        except ProcessLookupError:
            pass

    def _wait_ready(self) -> bool:
        deadline = time.monotonic() + READY_TIMEOUT_S
        topics = ["/odom", "/scan", "/did/battery"] + (["/map"] if self.map_mode == "slam" else [])
        while time.monotonic() < deadline:
            if all(self._has_message(topic) for topic in topics):
                return True
            time.sleep(1.0)
        return False

    @staticmethod
    def _has_message(topic: str) -> bool:
        result = subprocess.run(
            ros_shell(f"timeout 4 ros2 topic echo {topic} --once --no-daemon"),
            capture_output=True, check=False)
        return result.returncode == 0 and bool(result.stdout.strip())


SIMULATION = Simulation()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/status":
            self._reply(200, {"state": SIMULATION.state, "seed": SIMULATION.seed,
                                  "scenario": SIMULATION.scenario, "map_mode": SIMULATION.map_mode})
        else:
            self._reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/reset":
            return self._reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length) or b"{}")
            seed = int(request["seed"])
        except (ValueError, KeyError, TypeError):
            return self._reply(422, {"error": "seed_required"})
        scenario = request.get("scenario", DEFAULT_SCENARIO)
        if scenario not in SCENARIOS:
            return self._reply(422, {"error": "unknown_scenario", "allowed": list(SCENARIOS)})
        map_mode = request.get("map_mode", DEFAULT_MAP_MODE)
        if map_mode not in MAP_MODES:
            return self._reply(422, {"error": "unknown_map_mode", "allowed": list(MAP_MODES)})
        ok = SIMULATION.restart(seed, scenario, map_mode)
        self._reply(200 if ok else 500, {"state": SIMULATION.state, "seed": seed,
                                         "scenario": scenario, "map_mode": map_mode})

    def log_message(self, *_args):
        pass


def main():
    initial_seed = int(os.environ.get("INITIAL_SEED", "0"))
    threading.Thread(target=SIMULATION.restart, args=(initial_seed,), daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    signal.signal(signal.SIGTERM, lambda *_: (SIMULATION._stop_processes(), os._exit(0)))
    server.serve_forever()


if __name__ == "__main__":
    main()
