"""ROS callback contract: generation-bound observations, events and scores."""
import json
import math
import time

import pytest

rclpy = pytest.importorskip("rclpy")

from adapters.ros.bridge import RosBridge
from std_msgs.msg import String
from rosgraph_msgs.msg import Clock
from nav_msgs.msg import Odometry
from sensor_msgs.msg import LaserScan
from application.ports import OperationOutcome
from domain.geometry import Pose


@pytest.fixture
def bridge(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "83")
    if not rclpy.ok():
        rclpy.init()
    node = RosBridge()
    node.set_generation(2)
    yield node
    node.destroy_node()
    if rclpy.ok():
        rclpy.try_shutdown()


def test_event_and_score_callbacks_drop_other_generation(bridge):
    stale_event = String(data=json.dumps({"type": "hazard_hit", "sequence": 1, "generation": 1,
                                          "robot_id": "robot_1", "position": [1.0, 2.0],
                                          "simulation_time_s": 8.0}))
    stale_score = String(data=json.dumps({"collected": 1, "finished": True, "generation": 1}))
    bridge._on_event(stale_event)
    bridge._on_score(stale_score)
    assert bridge.events_after(0) == []
    assert bridge.score() is None


def test_bridge_accepts_separate_observation_topics_for_controlled_probes(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "83")
    if not rclpy.ok():
        rclpy.init()
    node = RosBridge(odom_topic="/t10/odom", scan_topic="/t10/scan")
    try:
        assert node._odom_topic == "/t10/odom"
        assert node._scan_topic == "/t10/scan"
        topics = dict(node.get_topic_names_and_types())
        assert "/t10/odom" in topics
        assert "/t10/scan" in topics
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.try_shutdown()


def test_event_callback_keeps_judge_pose_time_and_increments_sequence(bridge):
    current = String(data=json.dumps({"type": "hazard_hit", "sequence": 3, "generation": 2,
                                      "robot_id": "robot_1", "position": [1.25, -0.5],
                                      "simulation_time_s": 12.5, "battery": 44.0}))
    bridge._on_event(current)
    event = bridge.events_after(0)[0]
    assert event.sequence == 3 and event.generation == 2
    assert event.position.x_m == 1.25 and event.position.y_m == -0.5
    assert event.simulation_time_s == 12.5


def test_current_score_is_available_after_generation_switch(bridge):
    bridge._on_score(String(data=json.dumps({"collected": 2, "finished": False,
                                             "generation": 2, "simulation_time_s": 4.0})))
    assert bridge.score().generation == 2
    bridge.set_generation(3)
    assert bridge.score() is None


def test_simulation_clock_reset_backwards_is_treated_as_new_progress(bridge):
    first = Clock()
    first.clock.sec = 120
    bridge._on_clock(first)
    before = bridge._clock_progress_s
    reset = Clock()
    reset.clock.sec = 0
    reset.clock.nanosec = 500_000_000
    bridge._on_clock(reset)
    assert bridge._sim_clock.value == 0.5
    assert bridge._clock_progress_s >= before


def test_stopped_simulation_clock_expires_motion_lease(bridge):
    now = 100.0
    for holder in (bridge._odom, bridge._battery, bridge._scan):
        holder.received_s = now
    bridge._clock_progress_s = now
    assert not bridge._observations_stale_locked(now + 0.9)
    assert bridge._observations_stale_locked(now + bridge._max_age_s + 0.1)


@pytest.mark.parametrize("missing_source", ["odom", "scan", "battery"])
def test_independent_critical_source_loss_expires_observation_and_motion_lease(bridge, missing_source):
    now = time.monotonic()
    bridge._sim_clock.value = 4.0
    bridge._clock_progress_s = now
    for name in ("odom", "scan", "battery"):
        if name != missing_source:
            holder = getattr(bridge, f"_{name}")
            holder.received_s = now
            holder.value = object() if name != "odom" else None
    bridge._command = (0.2, 0.1)
    bridge._command_at_s = now

    assert bridge._observations_stale_locked(now + bridge._max_age_s + 0.01)
    bridge._publish_velocity()
    assert bridge._command == (0.0, 0.0)


def test_judge_reply_after_generation_change_is_unknown(bridge):
    class Future:
        def add_done_callback(self, callback):
            bridge.set_generation(3)
            callback(self)

        @staticmethod
        def result():
            return type("Response", (), {"success": True, "message": "collected"})()

    class Client:
        @staticmethod
        def wait_for_service(timeout_sec):
            return True

        @staticmethod
        def call_async(_request):
            return Future()

    reply = bridge._call(Client())
    assert reply.outcome is OperationOutcome.UNKNOWN
    assert not reply.success


def test_async_judge_operation_drops_late_success_after_generation_switch(bridge):
    class Future:
        resolved = False

        def done(self):
            return self.resolved

        @staticmethod
        def result():
            return type("Response", (), {"success": True, "message": "finished"})()

    class Client:
        future = Future()

        @staticmethod
        def service_is_ready():
            return True

        def call_async(self, _request):
            return self.future

    bridge._finish_client = Client()
    operation = bridge.begin_finish()
    assert operation.poll() is None
    bridge.set_generation(3)
    bridge._finish_client.future.resolved = True
    reply = operation.poll()
    assert reply.outcome is OperationOutcome.UNKNOWN
    assert not reply.success


def test_async_judge_operation_waits_for_service_discovery_without_blocking(bridge):
    class Future:
        resolved = False

        def done(self):
            return self.resolved

        @staticmethod
        def result():
            return type("Response", (), {"success": True, "message": "ready"})()

    class Client:
        ready = False
        requested = False
        future = Future()

        def service_is_ready(self):
            return self.ready

        def call_async(self, _request):
            self.requested = True
            return self.future

    client = Client()
    bridge._finish_client = client
    operation = bridge.begin_finish()
    assert operation.poll() is None
    assert not client.requested
    client.ready = True
    assert operation.poll() is None
    assert client.requested
    client.future.resolved = True
    reply = operation.poll()
    assert reply.success and reply.message == "ready"


def test_stale_telemetry_from_previous_generation_is_rejected(bridge):
    bridge._sim_clock.value = 1.0
    stale = String(data='{"generation":1,"robot_id":"robot_1","simulation_time_s":1.0,'
                         '"battery":58.0,"signal":0.7}')
    bridge._on_telemetry(stale)
    assert bridge._battery.value is None
    assert bridge._signal.value is None


def test_old_odom_and_scan_timestamps_are_rejected_after_clock_reset(bridge):
    bridge._sim_clock.value = 0.2
    odom = Odometry()
    odom.header.stamp.sec = 120
    odom.pose.pose.orientation.w = 1.0
    bridge._on_odom(odom)
    scan = LaserScan()
    scan.header.stamp.sec = 120
    bridge._on_scan(scan)
    assert bridge._odom.value is None
    assert bridge._scan.value is None


def test_laser_scan_hits_are_projected_to_world_points(bridge):
    bridge._sim_clock.value = 1.0
    odom = Odometry()
    odom.header.stamp.sec = 1
    odom.pose.pose.orientation.w = 1.0
    bridge._on_odom(odom)

    scan = LaserScan()
    scan.header.stamp.sec = 1
    scan.angle_min = 0.0
    scan.angle_increment = 0.1
    scan.range_min = 0.1
    scan.range_max = 5.0
    scan.ranges = [1.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0]
    bridge._on_scan(scan)

    points = bridge._scan.value
    assert len(points) == 2  # лучи прореживаются до каждого четвёртого
    assert points[0].x_m == pytest.approx(-1.0)
    assert points[0].y_m == pytest.approx(-0.5)
    assert points[1].x_m == pytest.approx(-2.0 + 2.0 * math.cos(0.4))
    assert points[1].y_m == pytest.approx(-0.5 + 2.0 * math.sin(0.4))


def test_current_generation_telemetry_refreshes_battery_and_signal(bridge):
    bridge._sim_clock.value = 2.5
    payload = String(data='{"generation":2,"robot_id":"robot_1","simulation_time_s":2.5,'
                          '"battery":47.5,"signal":0.4}')
    bridge._on_telemetry(payload)
    assert bridge._battery.value == 47.5
    assert bridge._signal.value == 0.4
    assert bridge._battery.simulation_time_s == 2.5


def test_latest_reports_freshness_for_each_critical_ros_source(bridge):
    now = time.monotonic()
    bridge._sim_clock.value = 12.0
    bridge._clock_progress_s = now - 0.03
    bridge._odom.value, bridge._odom.received_s = Pose(1.0, 2.0, 0.0), now - 0.02
    bridge._battery.value, bridge._battery.received_s = 50.0, now - 0.08
    bridge._scan.value, bridge._scan.received_s = (), now - 0.1

    observation = bridge.latest()

    assert observation is not None
    assert observation.freshness.odom.fresh is True
    assert observation.freshness.scan.age_s == pytest.approx(0.1, abs=0.02)
    assert observation.freshness.battery.fresh is True
    assert observation.freshness.clock.fresh is True


def test_scan_is_projected_with_pose_at_scan_stamp_not_latest_odom(bridge):
    bridge._sim_clock.value = 2.0
    for stamp_ns, yaw in ((0, 0.0), (200_000_000, 0.2)):  # поворот на 0.2 рад между scan и последней odom
        odom = Odometry()
        odom.header.stamp.sec, odom.header.stamp.nanosec = 2, stamp_ns
        odom.pose.pose.orientation.z, odom.pose.pose.orientation.w = math.sin(yaw / 2), math.cos(yaw / 2)
        bridge._on_odom(odom)
    scan = LaserScan()
    scan.header.stamp.sec = 2
    scan.angle_min, scan.angle_increment, scan.range_min, scan.range_max = 0.0, 0.1, 0.1, 5.0
    scan.ranges = [2.0]
    bridge._on_scan(scan)
    point = bridge._scan.value[0]
    assert point.x_m == pytest.approx(0.0) and point.y_m == pytest.approx(-0.5)  # курс 0 момента scan


def test_repeated_reads_preserve_signal_measurement_identity(bridge):
    clock = Clock()
    clock.clock.sec = 1
    bridge._on_clock(clock)
    bridge._odom.value = Pose(0, 0, 0)
    bridge._on_telemetry(String(data=json.dumps({"generation": 2, "robot_id": "robot_1",
        "simulation_time_s": 1.0, "battery": 50.0, "signal": 0.4})))
    first, second = bridge.latest(), bridge.latest()
    assert first.sample_signal_received_monotonic_s is not None
    assert first.sample_signal_received_monotonic_s == second.sample_signal_received_monotonic_s
    assert first.sequence != second.sequence
