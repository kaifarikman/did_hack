"""turtlebot3_world без GUI с несколькими Burger: у каждого свои топики, кадры и TF-префикс.

Аргумент robot_count (по умолчанию 2). Роботы: robot_1, robot_2, ... на площадках из default_bases.
Имя модели в Gazebo совпадает с идентификатором робота (судья читает позы по этим именам).
"""
import os
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, IncludeLaunchDescription, OpaqueFunction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from robot_model import bridge_arguments, default_bases, namespaced_sdf  # noqa: E402

GENERATED_DIR = "/tmp/did_robots"


def _robot_actions(context, *_args, **_kwargs):
    from launch.substitutions import LaunchConfiguration
    count = int(LaunchConfiguration("robot_count").perform(context))
    gazebo_share = get_package_share_directory("turtlebot3_gazebo")
    simulation_dir = os.environ.get("SIMULATION_DIR", "/workspace/simulation")
    with open(os.path.join(simulation_dir, "models", "turtlebot3_burger_contact", "model.sdf"),
              encoding="utf-8") as stream:
        source_sdf = stream.read()
    with open(os.path.join(gazebo_share, "urdf", "turtlebot3_burger.urdf"), encoding="utf-8") as stream:
        urdf = stream.read()
    os.makedirs(GENERATED_DIR, exist_ok=True)

    actions = []
    for robot, (x_m, y_m) in default_bases(count).items():
        sdf_path = os.path.join(GENERATED_DIR, f"{robot}.sdf")
        with open(sdf_path, "w", encoding="utf-8") as stream:
            stream.write(namespaced_sdf(source_sdf, robot))
        actions += [
            Node(package="ros_gz_sim", executable="create", output="screen",
                 arguments=["-name", robot, "-file", sdf_path, "-x", str(x_m), "-y", str(y_m), "-z", "0.01"]),
            Node(package="ros_gz_bridge", executable="parameter_bridge", name=f"bridge_{robot}",
                 output="screen", arguments=bridge_arguments(robot)),
            Node(package="robot_state_publisher", executable="robot_state_publisher", namespace=robot,
                 output="screen", remappings=[("/tf", "/tf"), ("tf", "/tf"), ("tf_static", "/tf_static")],
                 parameters=[{"use_sim_time": True, "robot_description": urdf, "frame_prefix": f"{robot}/"}]),
        ]
    return actions


def generate_launch_description():
    from launch.actions import DeclareLaunchArgument
    gazebo_share = get_package_share_directory("turtlebot3_gazebo")
    ros_gz_sim = get_package_share_directory("ros_gz_sim")
    simulation_dir = os.environ.get("SIMULATION_DIR", "/workspace/simulation")
    world = os.path.join(simulation_dir, "worlds", "turtlebot3_world_contact.world")
    gzserver = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(ros_gz_sim, "launch", "gz_sim.launch.py")),
        launch_arguments={"gz_args": ["-r -s -v2 ", world], "on_exit_shutdown": "true"}.items())
    clock_bridge = Node(package="ros_gz_bridge", executable="parameter_bridge", name="bridge_clock",
                        arguments=["/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock"], output="screen")
    return LaunchDescription([
        DeclareLaunchArgument("robot_count", default_value="2"),
        AppendEnvironmentVariable("GZ_SIM_RESOURCE_PATH", os.path.join(gazebo_share, "models")),
        gzserver, clock_bridge, OpaqueFunction(function=_robot_actions)])
