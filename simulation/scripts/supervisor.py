"""Супервизор симуляции: запускает Gazebo + судью и перезапускает их под новый seed.

Reset реализован как рестарт процессов: одометрия снова начинается с нуля у базы,
поэтому преобразование world = (-2.0, -0.5) + odom остаётся верным.

HTTP (внутренний, только сеть Compose):
  GET  /status        -> {"state": "starting|ready|failed", "seed": int|null, "scenario": str|null}
  POST /reset {"seed": int, "scenario": "easy|medium|hard", "map_mode": "static|slam", "robots": 1|2} -> блокируется до готовности или таймаута; 200/500
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
MAX_ROBOTS = 2
BASE_SPACING_M = 1.0
FIRST_BASE = (-2.0, -0.5)
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
        self.robots = 1

    def restart(self, seed: int, scenario: str = DEFAULT_SCENARIO, map_mode: str = DEFAULT_MAP_MODE,
                robots: int = 1):
        with self._lock:
            self.state, self.seed, self.scenario, self.map_mode = "starting", seed, scenario, map_mode
            self.robots = robots
            self._stop_processes()
            self._start_processes(seed, scenario, map_mode, robots)
            self.state = "ready" if self._wait_ready() else "failed"
            return self.state == "ready"

    def _start_processes(self, seed: int, scenario: str, map_mode: str, robots: int = 1):
        config = f"{SIM_DIR}/judge/config/local_{scenario}.json"
        if robots == 1:
            commands = [
                f"exec ros2 launch {SIM_DIR}/launch/headless_world.launch.py",
                f"exec python3 {SIM_DIR}/scripts/cmd_vel_guard.py",
                f"cd {SIM_DIR}/judge && exec python3 -m did_judge.ros_node --ros-args "
                f"-p seed:={seed} -p config_path:={config}",
            ]
        else:
            robot_ids = [f"robot_{index + 1}" for index in range(robots)]
            commands = [f"exec ros2 launch {SIM_DIR}/launch/multi_robot_world.launch.py robot_count:={robots}"]
            for index, robot_id in enumerate(robot_ids):
                base = f"{FIRST_BASE[0]},{FIRST_BASE[1] + index * BASE_SPACING_M}"
                commands.append(f"ROBOT_ID={robot_id} ROBOT_BASE={base} exec python3 {SIM_DIR}/scripts/cmd_vel_guard.py")
            ids_literal = "[" + ",".join(robot_ids) + "]"
            commands.append(f"cd {SIM_DIR}/judge && exec python3 -m did_judge.team_node --ros-args "
                            f"-p seed:={seed} -p config_path:={config} -p robot_ids:=\"{ids_literal}\"")
        if map_mode == "slam" and robots == 1:
            commands.append(f"exec ros2 launch slam_toolbox online_async_launch.py use_sim_time:=true "
                            f"slam_params_file:={SIM_DIR}/config/slam_params.yaml")
        elif map_mode == "slam":
            commands.append(f"exec ros2 launch {SIM_DIR}/launch/team_slam.launch.py robot_count:={robots}")
            commands.append(f"exec python3 {SIM_DIR}/mapping/merge_node.py")
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
        if self.robots == 1:
            topics = ["/odom", "/scan", "/did/battery"]
        else:
            topics = [f"/robot_{index + 1}/{name}" for index in range(self.robots)
                      for name in ("odom", "scan", "did/battery")]
        if self.map_mode == "slam":
            topics.append("/map" if self.robots == 1 else "/team/map")
        ready = set()  # топик, из которого пришло сообщение, остаётся готовым: проверка discovery под нагрузкой шумит
        while time.monotonic() < deadline:
            ready.update(topic for topic in topics if topic not in ready and self._has_message(topic))
            if len(ready) == len(topics):
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
                                  "scenario": SIMULATION.scenario, "map_mode": SIMULATION.map_mode,
                                  "robots": SIMULATION.robots})
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
        robots = request.get("robots", 1)
        if not isinstance(robots, int) or not 1 <= robots <= MAX_ROBOTS:
            return self._reply(422, {"error": "unknown_robot_count", "allowed": list(range(1, MAX_ROBOTS + 1))})
        ok = SIMULATION.restart(seed, scenario, map_mode, robots)
        self._reply(200 if ok else 500, {"state": SIMULATION.state, "seed": seed, "scenario": scenario,
                                         "map_mode": map_mode, "robots": robots})

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
