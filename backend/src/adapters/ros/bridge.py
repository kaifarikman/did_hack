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
import math
from dataclasses import dataclass

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rclpy.signals import SignalHandlerOptions
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Float32, String
from std_srvs.srv import Trigger

from adapters.ros.conversion import (
    PoseHistory, clamp_signal, finite_or_none, is_penalty_event, world_pose_from_odom, yaw_from_quaternion,
)
from adapters.ros.judge_messages import parse_public_event, parse_public_score, parse_public_telemetry
from application.ports import JudgeOperation, JudgeReply, OperationOutcome, PublicScore
from domain.events import PublicEvent
from domain.geometry import Point, Pose
from domain.observations import Observation, ObservationFreshness, SourceFreshness

AGENT_CMD_VEL_TOPIC = "/agent/cmd_vel"
PUBLISH_PERIOD_S = 0.05
PENALTY_MEMORY_S = 3.0


class _RosJudgeOperation:
    def __init__(self, bridge: "RosBridge", client, generation: int | None, timeout_s: float) -> None:
        self._bridge = bridge
        self._client = client
        self._future = None
        self._generation = generation
        self._deadline_s = time.monotonic() + timeout_s
        self._resolved: JudgeReply | None = None

    def poll(self) -> JudgeReply | None:
        if self._resolved is not None:
            return self._resolved
        with self._bridge._lock:
            if self._bridge._generation != self._generation:
                return self._unknown("ответ судьи пришёл из другого поколения")
        if time.monotonic() >= self._deadline_s:
            return self._unknown("судья не ответил вовремя")
        if self._future is None:
            if not self._client.service_is_ready():
                return None
            try:
                self._future = self._client.call_async(Trigger.Request())
            except Exception as error:
                return self._unknown(f"ошибка запроса судье: {error}")
        if not self._future.done():
            return None
        try:
            response = self._future.result()
        except Exception as error:
            return self._unknown(f"ошибка ответа судьи: {error}")
        with self._bridge._lock:
            if self._bridge._generation != self._generation:
                return self._unknown("ответ судьи пришёл из другого поколения")
        self._resolved = JudgeReply(bool(response.success), str(response.message))
        return self._resolved

    def _unknown(self, message: str) -> JudgeReply:
        self._resolved = JudgeReply(False, message, OperationOutcome.UNKNOWN)
        return self._resolved


@dataclass
class _Stamped:
    value: object | None = None
    received_s: float | None = None
    simulation_time_s: float | None = None


class RosBridge(Node):
    def __init__(self, observation_max_age_s: float = 1.0, command_ttl_s: float = 0.5,
                 service_timeout_s: float = 5.0, odom_topic: str = "/odom",
                 scan_topic: str = "/scan") -> None:
        super().__init__("did_backend_bridge")
        if not odom_topic or not scan_topic:
            raise ValueError("observation topic names must not be empty")
        self._max_age_s = observation_max_age_s
        self._command_ttl_s = command_ttl_s
        self._service_timeout_s = service_timeout_s
        self._lock = threading.Lock()
        self._odom = _Stamped()
        self._odom_history = PoseHistory()
        self._battery = _Stamped()
        self._signal = _Stamped()
        self._scan = _Stamped()
        self._sim_clock = _Stamped()
        self._clock_progress_s: float | None = None  # когда часы симуляции последний раз изменились
        self._penalty_at_s: float | None = None
        self._events: list[PublicEvent] = []
        self._event_sequence = 0
        self._generation: int | None = None
        self._observation_sequence = 0
        self._score: PublicScore | None = None
        self._command = (0.0, 0.0)
        self._command_at_s = 0.0
        self._ever_connected = False

        self._odom_topic = odom_topic
        self._scan_topic = scan_topic
        self.create_subscription(Odometry, odom_topic, self._on_odom, 10)
        self.create_subscription(LaserScan, scan_topic, self._on_scan, qos_profile_sensor_data)
        self.create_subscription(Float32, "/did/battery", self._on_battery, 10)
        self.create_subscription(Float32, "/did/sample_sensor", self._on_signal, 10)
        self.create_subscription(String, "/did/telemetry", self._on_telemetry, 10)
        self.create_subscription(String, "/did/events", self._on_event, 10)
        self.create_subscription(String, "/did/score", self._on_score, 10)
        self.create_subscription(Clock, "/clock", self._on_clock, 10)
        self._velocity_publisher = self.create_publisher(TwistStamped, AGENT_CMD_VEL_TOPIC, 10)
        self._collect_client = self.create_client(Trigger, "/did/collect")
        self._finish_client = self.create_client(Trigger, "/did/finish")
        self.create_timer(PUBLISH_PERIOD_S, self._publish_velocity)

    # ------------------------------------------------------------ callbacks

    def _stamp(self, holder: _Stamped, value: object, simulation_time_s: float | None = None) -> None:
        with self._lock:
            holder.value, holder.received_s, holder.simulation_time_s = value, time.monotonic(), simulation_time_s
            self._ever_connected = True

    def _stamp_is_current(self, source_time_s: float) -> bool:
        if self._sim_clock.value is None:
            return False
        return -0.5 <= float(self._sim_clock.value) - source_time_s <= self._max_age_s

    def _on_odom(self, message: Odometry) -> None:
        simulation_time_s = message.header.stamp.sec + message.header.stamp.nanosec * 1e-9
        with self._lock:
            if not self._stamp_is_current(simulation_time_s):
                return
        orientation, position = message.pose.pose.orientation, message.pose.pose.position
        yaw = yaw_from_quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
        pose = world_pose_from_odom(position.x, position.y, yaw)
        if pose is not None:
            with self._lock:
                self._odom_history.add(simulation_time_s, pose)
        self._stamp(self._odom, pose, simulation_time_s)

    def _on_scan(self, message: LaserScan) -> None:
        simulation_time_s = message.header.stamp.sec + message.header.stamp.nanosec * 1e-9
        with self._lock:
            if not self._stamp_is_current(simulation_time_s):
                return
            # поза момента scan; без истории — последняя, как раньше
            pose: Pose | None = self._odom_history.at(simulation_time_s) or self._odom.value  # type: ignore[assignment]
        obstacle_points: list[Point] = []
        if pose is not None:
            max_range_m = min(float(message.range_max), 4.0)
            for index in range(0, len(message.ranges), 4):
                distance = float(message.ranges[index])
                if not math.isfinite(distance) or not message.range_min <= distance <= max_range_m:
                    continue
                angle = pose.heading_rad + message.angle_min + index * message.angle_increment
                obstacle_points.append(Point(pose.x_m + distance * math.cos(angle),
                                             pose.y_m + distance * math.sin(angle)))
        self._stamp(self._scan, tuple(obstacle_points), simulation_time_s)

    def _on_battery(self, message: Float32) -> None:
        if self._generation is not None:
            return  # после handshake версии 2 принимается только telemetry envelope с generation
        self._stamp(self._battery, finite_or_none(message.data))

    def _on_signal(self, message: Float32) -> None:
        if self._generation is not None:
            return
        self._stamp(self._signal, clamp_signal(message.data))

    def _on_telemetry(self, message: String) -> None:
        telemetry = parse_public_telemetry(message.data)
        if telemetry is None:
            return
        with self._lock:
            if (telemetry.generation != self._generation
                    or telemetry.robot_id != "robot_1"
                    or (self._sim_clock.value is not None
                        and telemetry.simulation_time_s < float(self._sim_clock.value) - self._max_age_s)):
                return
            received_s = time.monotonic()
            self._battery.value, self._battery.received_s = telemetry.battery, received_s
            self._battery.simulation_time_s = telemetry.simulation_time_s
            self._signal.value = telemetry.signal
            self._signal.received_s = received_s if telemetry.signal is not None else None
            self._signal.simulation_time_s = telemetry.simulation_time_s
            self._ever_connected = True

    def _on_event(self, message: String) -> None:
        with self._lock:
            event = parse_public_event(message.data, self._event_sequence + 1)
            if event is None:
                return
            if self._generation is not None and event.generation != self._generation:
                return
            if event.position is None and self._odom.value is not None:
                pose = self._odom.value
                event = PublicEvent(event.sequence, event.kind, self._sim_clock.value, event.robot_id,
                                    event.generation, pose.point, event.battery_after)
            if any(saved.sequence == event.sequence for saved in self._events):
                return
            self._event_sequence = max(self._event_sequence, event.sequence)
            self._events.append(event)
            if is_penalty_event(event.kind.value):
                self._penalty_at_s = time.monotonic()

    def _on_score(self, message: String) -> None:
        with self._lock:
            score = parse_public_score(message.data)
            if score is None or (self._generation is not None and score.generation != self._generation):
                return
            self._score = score

    def events_after(self, sequence: int) -> list[PublicEvent]:
        with self._lock:
            return [event for event in self._events if event.sequence > sequence]

    def score(self) -> PublicScore | None:
        with self._lock:
            return self._score

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
            pose: Pose | None = self._odom.value  # type: ignore[assignment]
            self._observation_sequence += 1
            signal_fresh = self._signal.received_s is not None and now - self._signal.received_s <= self._max_age_s
            penalty = self._penalty_at_s is not None and now - self._penalty_at_s <= PENALTY_MEMORY_S
            def freshness(received_s: float | None) -> SourceFreshness:
                if received_s is None:
                    return SourceFreshness()
                age_s = max(0.0, now - received_s)
                return SourceFreshness(age_s=age_s, fresh=age_s <= self._max_age_s)

            return Observation(
                simulation_time_s=self._sim_clock.value,  # type: ignore[arg-type]
                pose=pose,
                battery_remaining=self._battery.value,  # type: ignore[arg-type]
                sample_signal=self._signal.value if signal_fresh else None,  # type: ignore[arg-type]
                received_monotonic_s=min((stamp for stamp in sources if stamp is not None), default=now),
                penalty_recent=penalty,
                sequence=self._observation_sequence,
                generation=self._generation,
                sample_signal_received_monotonic_s=self._signal.received_s,
                sample_signal_age_s=(None if self._signal.received_s is None
                                     else max(0.0, now - self._signal.received_s)),
                scan_obstacles=tuple(self._scan.value or ()),
                freshness=ObservationFreshness(
                    odom=freshness(self._odom.received_s),
                    scan=freshness(self._scan.received_s),
                    battery=freshness(self._battery.received_s),
                    clock=freshness(self._clock_progress_s),
                ),
            )

    def clear_observations(self) -> None:
        """Сброс кэша между прогонами; движение прекращается."""
        self.stop()
        with self._lock:
            for holder in (self._odom, self._battery, self._signal, self._scan, self._sim_clock):
                holder.value, holder.received_s, holder.simulation_time_s = None, None, None
            self._clock_progress_s = None
            self._odom_history.clear()
            self._penalty_at_s = None
            self._events.clear()
            self._event_sequence = 0
            self._observation_sequence = 0
            self._score = None

    def set_generation(self, generation: int) -> None:
        if type(generation) is not int or generation < 0:
            raise ValueError("generation должен быть неотрицательным целым")
        with self._lock:
            self._generation = generation
            self._observation_sequence = 0
            self._events.clear()
            self._event_sequence = 0
            self._score = None

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

    def begin_collect(self) -> JudgeOperation:
        return self._begin_call(self._collect_client)

    def begin_finish(self) -> JudgeOperation:
        return self._begin_call(self._finish_client)

    def _begin_call(self, client) -> JudgeOperation:
        with self._lock:
            request_generation = self._generation
        return _RosJudgeOperation(self, client, request_generation, self._service_timeout_s)

    def collect(self) -> JudgeReply:
        return self._call(self._collect_client)

    def finish(self) -> JudgeReply:
        return self._call(self._finish_client)

    def _call(self, client) -> JudgeReply:
        with self._lock:
            request_generation = self._generation
        if not client.wait_for_service(timeout_sec=self._service_timeout_s):
            return JudgeReply(False, "сервис судьи недоступен", OperationOutcome.UNKNOWN)
        done = threading.Event()
        future = client.call_async(Trigger.Request())
        future.add_done_callback(lambda _: done.set())
        if not done.wait(self._service_timeout_s):
            return JudgeReply(False, "судья не ответил вовремя", OperationOutcome.UNKNOWN)
        try:
            response = future.result()
        except Exception as error:
            return JudgeReply(False, f"ошибка ответа судьи: {error}", OperationOutcome.UNKNOWN)
        with self._lock:
            if self._generation != request_generation:
                return JudgeReply(False, "ответ судьи пришёл из другого поколения", OperationOutcome.UNKNOWN)
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
        # All callbacks use one MutuallyExclusive group and are non-blocking.
        # A worker pool adds contention at the ~1 kHz clock rate without parallelism.
        self._executor = SingleThreadedExecutor()
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
