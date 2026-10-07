"""ROS-мост: наблюдения, команды скорости и вызовы судьи. Единственный владелец команд скорости.

Безопасность движения:
- команда живёт `command_ttl_s`; без обновления мост публикует нулевую скорость;
- при устаревших odom/scan/battery/clock (монотонное время процесса) команда обнуляется
  независимо от HTTP, LLM и контроллера;
- guard у робота (simulation/scripts/cmd_vel_guard.py) останавливает его, если процесс backend пропал.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rclpy.signals import SignalHandlerOptions
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Float32, String
from std_srvs.srv import Trigger

from adapters.ros.conversion import clamp_signal, finite_or_none, is_penalty_event, world_pose_from_odom, yaw_from_quaternion
from application.ports import JudgeReply
from domain.geometry import Pose
from domain.observations import Observation

AGENT_CMD_VEL_TOPIC = "/agent/cmd_vel"
PUBLISH_PERIOD_S = 0.05
PENALTY_MEMORY_S = 3.0


@dataclass
class _Stamped:
    value: object | None = None
    received_s: float | None = None


class RosBridge(Node):
    def __init__(self, observation_max_age_s: float = 1.0, command_ttl_s: float = 0.5,
                 service_timeout_s: float = 5.0) -> None:
        super().__init__("did_backend_bridge")
        self._max_age_s = observation_max_age_s
        self._command_ttl_s = command_ttl_s
        self._service_timeout_s = service_timeout_s
        self._lock = threading.Lock()
        self._odom = _Stamped()
        self._battery = _Stamped()
        self._signal = _Stamped()
        self._scan = _Stamped()
        self._sim_clock = _Stamped()
        self._clock_progress_s: float | None = None  # когда часы симуляции последний раз изменились
        self._penalty_at_s: float | None = None
        self._command = (0.0, 0.0)
        self._command_at_s = 0.0
        self._ever_connected = False

        self.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self.create_subscription(LaserScan, "/scan", self._on_scan, qos_profile_sensor_data)
        self.create_subscription(Float32, "/did/battery", self._on_battery, 10)
        self.create_subscription(Float32, "/did/sample_sensor", self._on_signal, 10)
        self.create_subscription(String, "/did/events", self._on_event, 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self._velocity_publisher = self.create_publisher(TwistStamped, AGENT_CMD_VEL_TOPIC, 10)
        self._collect_client = self.create_client(Trigger, "/did/collect")
        self._finish_client = self.create_client(Trigger, "/did/finish")
        self.create_timer(PUBLISH_PERIOD_S, self._publish_velocity)

    # ------------------------------------------------------------ callbacks

    def _stamp(self, holder: _Stamped, value: object) -> None:
        with self._lock:
            holder.value, holder.received_s = value, time.monotonic()
            self._ever_connected = True

    def _on_odom(self, message: Odometry) -> None:
        orientation, position = message.pose.pose.orientation, message.pose.pose.position
        yaw = yaw_from_quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
        self._stamp(self._odom, world_pose_from_odom(position.x, position.y, yaw))

    def _on_scan(self, message: LaserScan) -> None:
        self._stamp(self._scan, True)

    def _on_battery(self, message: Float32) -> None:
        self._stamp(self._battery, finite_or_none(message.data))

    def _on_signal(self, message: Float32) -> None:
        self._stamp(self._signal, clamp_signal(message.data))

    def _on_event(self, message: String) -> None:
        if is_penalty_event(message.data):
            with self._lock:
                self._penalty_at_s = time.monotonic()

    def _on_clock(self, message: Clock) -> None:
        simulation_time_s = message.clock.sec + message.clock.nanosec * 1e-9
        now = time.monotonic()
        with self._lock:
            if self._sim_clock.value != simulation_time_s:
                self._clock_progress_s = now
            self._sim_clock.value, self._sim_clock.received_s = simulation_time_s, now
            self._ever_connected = True

    # ------------------------------------------------- ObservationSource

    def latest(self) -> Observation | None:
        """None, пока нет odom, батареи и scan; received_monotonic_s — время самого старого источника."""
        now = time.monotonic()
        with self._lock:
            sources = (self._odom.received_s, self._battery.received_s, self._scan.received_s,
                       self._clock_progress_s)
            if any(stamp is None for stamp in sources) or self._odom.value is None:
                return None
            pose: Pose = self._odom.value  # type: ignore[assignment]
            signal_fresh = self._signal.received_s is not None and now - self._signal.received_s <= self._max_age_s
            penalty = self._penalty_at_s is not None and now - self._penalty_at_s <= PENALTY_MEMORY_S
            return Observation(
                simulation_time_s=self._sim_clock.value,  # type: ignore[arg-type]
                pose=pose,
                battery_remaining=self._battery.value,  # type: ignore[arg-type]
                sample_signal=self._signal.value if signal_fresh else None,  # type: ignore[arg-type]
                received_monotonic_s=min(stamp for stamp in sources if stamp is not None),
                penalty_recent=penalty,
            )

    def clear_observations(self) -> None:
        """Сброс кэша между прогонами; движение прекращается."""
        self.stop()
        with self._lock:
            for holder in (self._odom, self._battery, self._signal, self._scan, self._sim_clock):
                holder.value, holder.received_s = None, None
            self._clock_progress_s = None
            self._penalty_at_s = None

    # ------------------------------------------------------ VelocityDrive

    def command(self, linear_mps: float, angular_radps: float) -> None:
        with self._lock:
            self._command = (float(linear_mps), float(angular_radps))
            self._command_at_s = time.monotonic()

    def stop(self) -> None:
        with self._lock:
            self._command = (0.0, 0.0)
            self._command_at_s = time.monotonic()
        self._send_velocity(0.0, 0.0)

    def _observations_stale_locked(self, now: float) -> bool:
        sources = (self._odom.received_s, self._battery.received_s, self._scan.received_s, self._clock_progress_s)
        return any(stamp is None or now - stamp > self._max_age_s for stamp in sources)

    def _publish_velocity(self) -> None:
        now = time.monotonic()
        with self._lock:
            expired = now - self._command_at_s > self._command_ttl_s
            if expired or self._observations_stale_locked(now):
                self._command = (0.0, 0.0)  # остановка без возобновления: команду должен выдать исполнитель
            linear, angular = self._command
        self._send_velocity(linear, angular)

    def _send_velocity(self, linear_mps: float, angular_radps: float) -> None:
        message = TwistStamped()
        message.header.stamp = self.get_clock().now().to_msg()
        message.header.frame_id = "base_link"
        message.twist.linear.x, message.twist.angular.z = linear_mps, angular_radps
        self._velocity_publisher.publish(message)

    # --------------------------------------------------------- JudgeClient

    def collect(self) -> JudgeReply:
        return self._call(self._collect_client)

    def finish(self) -> JudgeReply:
        return self._call(self._finish_client)

    def _call(self, client) -> JudgeReply:
        if not client.wait_for_service(timeout_sec=self._service_timeout_s):
            return JudgeReply(False, "сервис судьи недоступен")
        done = threading.Event()
        future = client.call_async(Trigger.Request())
        future.add_done_callback(lambda _: done.set())
        if not done.wait(self._service_timeout_s):
            return JudgeReply(False, "судья не ответил вовремя")
        response = future.result()
        return JudgeReply(bool(response.success), str(response.message))

    # --------------------------------------------------------- EnvironmentStatus

    judge_mode = "local"

    def ros_connected(self) -> bool:
        with self._lock:
            return self._ever_connected and not self._observations_stale_locked(time.monotonic())

    def llm_available(self) -> bool:  # переопределяется точкой запуска через LlmAwareEnvironment
        return False


class RosRuntime:
    """Запускает rclpy и executor в фоновом потоке."""

    def __init__(self, **bridge_options) -> None:
        # SIGTERM принадлежит серверу приложения: сначала stop, затем закрытие ROS.
        rclpy.init(signal_handler_options=SignalHandlerOptions.NO)
        self._shutdown_lock = threading.Lock()
        self._closed = False
        self.bridge = RosBridge(**bridge_options)
        self._executor = MultiThreadedExecutor(num_threads=4)
        self._executor.add_node(self.bridge)
        self._thread = threading.Thread(target=self._executor.spin, name="ros-spin", daemon=True)
        self._thread.start()

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._closed:
                return
            self._closed = True
            try:
                if self.bridge.context.ok():
                    self.bridge.stop()
            finally:
                self._executor.shutdown()
                self._thread.join(timeout=2.0)
                self.bridge.destroy_node()
                rclpy.try_shutdown()
