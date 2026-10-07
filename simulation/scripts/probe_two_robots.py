"""Проба двух роботов: команды адресны, TF и физические позы раздельны.

Запуск внутри контейнера при запущенном multi_robot_world.launch.py:
  source /opt/ros/jazzy/setup.bash && GZ_PARTITION=did python3 /workspace/simulation/scripts/probe_two_robots.py
Едет только robot_1; robot_2 должен остаться на месте. Печатает перемещения по odom и по физической позе Gazebo.
"""
import math
import os
import sys
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from tf2_ros import Buffer, TransformListener

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "judge"))
from did_judge.gazebo_pose import GazeboPoseSource  # noqa: E402

ROBOTS = ("robot_1", "robot_2")
SPEED_M_S = 0.1
DRIVE_S = 5.0


class Probe(Node):
    def __init__(self):
        super().__init__("two_robot_probe")
        self.odom = {robot: None for robot in ROBOTS}
        self.tf_buffer = Buffer()
        TransformListener(self.tf_buffer, self)
        self.command_publishers = {robot: self.create_publisher(TwistStamped, f"/{robot}/cmd_vel", 10) for robot in ROBOTS}
        for robot in ROBOTS:
            self.create_subscription(Odometry, f"/{robot}/odom", lambda m, r=robot: self.odom.__setitem__(
                r, (m.pose.pose.position.x, m.pose.pose.position.y)), 10)

    def spin_for(self, seconds, driven=None):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if driven:
                command = TwistStamped()
                command.twist.linear.x = SPEED_M_S
                self.command_publishers[driven].publish(command)
            rclpy.spin_once(self, timeout_sec=0.05)


def physical_poses(source, names):
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        poses = {name: source.latest_for(name) for name in names}
        if all(poses.values()):
            return poses
        time.sleep(0.1)
    return poses


def main():
    rclpy.init()
    probe = Probe()
    source = GazeboPoseSource(entity_names=ROBOTS)
    probe.spin_for(3.0)
    before_odom, before_truth = dict(probe.odom), physical_poses(source, ROBOTS)
    probe.spin_for(DRIVE_S, driven="robot_1")
    probe.spin_for(1.0)
    after_odom, after_truth = dict(probe.odom), physical_poses(source, ROBOTS)
    for robot in ROBOTS:
        odom_move = math.dist(before_odom[robot], after_odom[robot])
        truth_move = math.dist(before_truth[robot][:2], after_truth[robot][:2])
        print(f"{robot}: odom_move_m={odom_move:.3f} gazebo_move_m={truth_move:.3f} "
              f"start_world={tuple(round(v, 2) for v in before_truth[robot][:2])}")
    for frame in ("robot_1/base_scan", "robot_2/base_scan"):
        try:
            probe.tf_buffer.lookup_transform(f"{frame.split('/')[0]}/odom", frame, rclpy.time.Time())
            print(f"tf {frame}: ok")
        except Exception as error:
            print(f"tf {frame}: {error}")
    rclpy.shutdown()


if __name__ == "__main__":
    main()
