#!/bin/bash
# Печатает текущий odom.x (диагностика движения: ROS_DOMAIN_ID=7).
source /opt/ros/jazzy/setup.bash
ros2 topic echo /odom --once --field pose.pose.position.x 2>/dev/null | head -1
