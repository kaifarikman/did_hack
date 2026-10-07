"""По экземпляру SLAM Toolbox на каждого робота: кадры robot_N/{map,odom,base_footprint}, карта /robot_N/map.

Запуск: ros2 launch team_slam.launch.py robot_count:=2. Общая карта мира собирается узлом mapping/merge_node.py.
Узлы lifecycle: configure → activate выполняются автоматически (как в online_async_launch.py пакета).
"""
import os

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, EmitEvent, OpaqueFunction, RegisterEventHandler
from launch.events import matches_action
from launch_ros.actions import LifecycleNode
from launch_ros.event_handlers import OnStateTransition
from launch_ros.events.lifecycle import ChangeState
from lifecycle_msgs.msg import Transition

SLAM_PARAMS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "slam_params.yaml")


def _slam_actions(context, *_args, **_kwargs):
    from launch.substitutions import LaunchConfiguration
    actions = []
    for index in range(int(LaunchConfiguration("robot_count").perform(context))):
        robot = f"robot_{index + 1}"
        node = LifecycleNode(
            package="slam_toolbox", executable="async_slam_toolbox_node", name="slam_toolbox",
            namespace=robot, output="screen",
            parameters=[SLAM_PARAMS, {"use_sim_time": True, "odom_frame": f"{robot}/odom",
                                      "map_frame": f"{robot}/map", "base_frame": f"{robot}/base_footprint",
                                      "scan_topic": f"/{robot}/scan"}],
            remappings=[("/tf", "/tf"), ("tf", "/tf"), ("tf_static", "/tf_static"),
                         # slam_toolbox использует абсолютные /map, /map_metadata: без ремапа роботы пишут в один топик
                         ("/map", f"/{robot}/map"), ("/map_metadata", f"/{robot}/map_metadata")])
        actions += [
            node,
            EmitEvent(event=ChangeState(lifecycle_node_matcher=matches_action(node),
                                        transition_id=Transition.TRANSITION_CONFIGURE)),
            RegisterEventHandler(OnStateTransition(
                target_lifecycle_node=node, start_state="configuring", goal_state="inactive",
                entities=[EmitEvent(event=ChangeState(lifecycle_node_matcher=matches_action(node),
                                                      transition_id=Transition.TRANSITION_ACTIVATE))])),
        ]
    return actions


def generate_launch_description():
    return LaunchDescription([DeclareLaunchArgument("robot_count", default_value="2"),
                              OpaqueFunction(function=_slam_actions)])
