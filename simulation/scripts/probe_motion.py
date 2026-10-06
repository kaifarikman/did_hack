"""Диагностика BE-01: часы, одометрия, лидар, движение и остановка робота."""
import math
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan

START_WORLD = (-2.0, -0.5)


class MotionProbe(Node):
    def __init__(self):
        super().__init__('motion_probe')
        self.clock_s = None
        self.odom_xy = None
        self.scan_count = 0
        self.scan_min = None
        self.create_subscription(Clock, '/clock', self._on_clock, 10)
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_subscription(LaserScan, '/scan', self._on_scan, 10)
        self.cmd_pub = self.create_publisher(TwistStamped, '/cmd_vel', 10)

    def _on_clock(self, message):
        self.clock_s = message.clock.sec + message.clock.nanosec * 1e-9

    def _on_odom(self, message):
        position = message.pose.pose.position
        self.odom_xy = (position.x, position.y)

    def _on_scan(self, message):
        self.scan_count += 1
        finite = [value for value in message.ranges if math.isfinite(value)]
        self.scan_min = min(finite) if finite else None

    def send_velocity(self, linear_mps):
        command = TwistStamped()
        command.header.stamp = self.get_clock().now().to_msg()
        command.twist.linear.x = linear_mps
        self.cmd_pub.publish(command)


def spin_for(node, seconds, linear_mps=None):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if linear_mps is not None:
            node.send_velocity(linear_mps)
        rclpy.spin_once(node, timeout_sec=0.05)


def world_of(odom_xy):
    return (START_WORLD[0] + odom_xy[0], START_WORLD[1] + odom_xy[1])


def main():
    rclpy.init()
    node = MotionProbe()
    spin_for(node, 3.0)
    print(f'clock_s={node.clock_s} odom={node.odom_xy} scan_msgs={node.scan_count} scan_min={node.scan_min}')
    clock_before = node.clock_s
    odom_before = node.odom_xy
    spin_for(node, 5.0, linear_mps=0.1)
    odom_moving = node.odom_xy
    print(f'MOVE: clock +{node.clock_s - clock_before:.2f}s odom {odom_before} -> {odom_moving} world {world_of(odom_moving)}')
    spin_for(node, 0.0)
    for _ in range(3):
        node.send_velocity(0.0)
        spin_for(node, 0.2)
    spin_for(node, 1.0, linear_mps=0.0)
    odom_stopped = node.odom_xy
    spin_for(node, 3.0)
    odom_after = node.odom_xy
    drift = math.dist(odom_stopped, odom_after)
    print(f'STOP: odom {odom_stopped} -> {odom_after} drift_m={drift:.5f}')
    print('RESULT', 'OK' if math.dist(odom_before, odom_moving) > 0.2 and drift < 0.01 else 'FAIL')
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
