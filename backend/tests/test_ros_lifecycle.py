"""Проверка жизненного цикла настоящего rclpy в изолированном ROS-домене.

На машине без ROS модуль пропускается; выполнять в контейнере с ROS_DOMAIN_ID=79.
"""
import os

import pytest

rclpy = pytest.importorskip("rclpy")

from adapters.ros.bridge import RosRuntime


@pytest.fixture(autouse=True)
def isolated_ros_domain(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "79")
    yield
    if rclpy.ok():
        rclpy.try_shutdown()


def test_shutdown_after_ros_context_was_closed():
    runtime = RosRuntime()
    rclpy.try_shutdown()
    runtime.shutdown()
    assert not runtime._thread.is_alive()


def test_shutdown_is_idempotent():
    runtime = RosRuntime()
    runtime.shutdown()
    runtime.shutdown()
    assert not rclpy.ok()


def test_application_owns_sigterm_until_graceful_shutdown():
    import signal
    import time

    received_signals = []
    previous_handler = signal.signal(signal.SIGTERM, lambda signum, _: received_signals.append(signum))
    runtime = None
    try:
        runtime = RosRuntime()
        os.kill(os.getpid(), signal.SIGTERM)
        time.sleep(0.1)  # rclpy обрабатывает сигнал в отдельном потоке
        assert received_signals == [signal.SIGTERM]
        assert rclpy.ok(), "ROS не должен закрывать контекст раньше shutdown приложения"
    finally:
        if runtime is not None:
            runtime.shutdown()
        signal.signal(signal.SIGTERM, previous_handler)
