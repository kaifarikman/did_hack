"""Tests for the Gazebo-side velocity watchdog, independent of the backend."""
import importlib.util
import pathlib
import sys
import time

import pytest

rclpy = pytest.importorskip("rclpy")
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry

SCRIPT = pathlib.Path(__file__).parents[2] / "scripts" / "cmd_vel_guard.py"
spec = importlib.util.spec_from_file_location("cmd_vel_guard", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


@pytest.fixture
def guard(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "83")
    if not rclpy.ok():
        rclpy.init()
    node = module.CmdVelGuard()
    published = []
    node._publisher.publish = published.append
    yield node, published
    node.destroy_node()
    if rclpy.ok():
        rclpy.try_shutdown()


def test_missing_agent_command_publishes_zero_after_watchdog_timeout(guard):
    node, published = guard
    node._last_command_s = time.monotonic() - module.COMMAND_TIMEOUT_S - 0.1

    node._enforce_timeout()

    assert len(published) == 1
    assert published[0].twist.linear.x == 0.0
    assert published[0].twist.angular.z == 0.0


def test_backend_command_is_relayed_then_watchdog_stops_after_command_loss(guard):
    node, published = guard
    command = TwistStamped()
    command.twist.linear.x = 0.2
    command.twist.angular.z = -0.3

    node._relay(command)
    assert published[-1].twist.linear.x == 0.2
    assert published[-1].twist.angular.z == -0.3

    node._last_command_s -= module.COMMAND_TIMEOUT_S + 0.1
    node._enforce_timeout()

    assert published[-1].twist.linear.x == 0.0
    assert published[-1].twist.angular.z == 0.0


def test_watchdog_lease_expires_at_configured_half_second(monkeypatch, guard):
    node, published = guard
    now = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    node._last_command_s = 99.0
    node._enforce_timeout()
    assert published[-1].twist.linear.x == 0.0

    command = TwistStamped()
    command.twist.linear.x = 0.1
    node._relay(command)
    assert published[-1].twist.linear.x == 0.1

    now[0] += module.COMMAND_TIMEOUT_S - 0.01
    node._enforce_timeout()
    assert published[-1].twist.linear.x == 0.1

    now[0] += 0.02
    node._enforce_timeout()
    assert published[-1].twist.linear.x == 0.0
