"""Real executor regression: async judge responses progress on the ROS thread."""
import time

import pytest

rclpy = pytest.importorskip("rclpy")
from rclpy.node import Node
from std_srvs.srv import Trigger
from adapters.ros.bridge import RosRuntime


def test_runtime_services_complete_without_blocking_executor(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "83")
    runtime = RosRuntime()
    judge = Node("runtime_judge_test")
    def collect(request, response):
        response.success = True
        response.message = "collected"
        return response
    judge.create_service(Trigger, "/did/collect", collect)
    runtime._executor.add_node(judge)
    try:
        operation = runtime.bridge.begin_collect()
        reply = None
        deadline = time.monotonic() + 3
        while reply is None and time.monotonic() < deadline:
            reply = operation.poll()
            time.sleep(0.01)
        assert reply is not None and reply.success
    finally:
        runtime._executor.remove_node(judge)
        judge.destroy_node()
        runtime.shutdown()
