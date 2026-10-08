"""Запуск turtlebot3_world с физическими контактными датчиками Burger."""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

import sys

sys.path.insert(0, os.path.join(os.environ.get('SIMULATION_DIR', '/workspace/simulation'), 'scripts'))
from robot_model import contact_bridge_arguments  # noqa: E402


def generate_launch_description():
    gazebo_share = get_package_share_directory('turtlebot3_gazebo')
    simulation_dir = os.environ.get('SIMULATION_DIR', '/workspace/simulation')
    ros_gz_sim = get_package_share_directory('ros_gz_sim')
    model_path = os.path.join(simulation_dir, 'models', 'turtlebot3_burger_contact', 'model.sdf')
    world_path = os.path.join(simulation_dir, 'worlds', 'turtlebot3_world_contact.world')

    gzserver = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(ros_gz_sim, 'launch', 'gz_sim.launch.py')),
        launch_arguments={'gz_args': ['-r -s -v2 ', world_path], 'on_exit_shutdown': 'true'}.items(),
    )
    state_publisher = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(gazebo_share, 'launch', 'robot_state_publisher.launch.py')),
        launch_arguments={'use_sim_time': 'true'}.items(),
    )
    spawn = Node(
        package='ros_gz_sim', executable='create', output='screen',
        arguments=['-name', 'burger', '-file', model_path,
                   '-x', LaunchConfiguration('x_pose', default='-2.0'),
                   '-y', LaunchConfiguration('y_pose', default='-0.5'), '-z', '0.01'],
    )
    bridge_params = os.path.join(gazebo_share, 'params', 'turtlebot3_burger_bridge.yaml')
    standard_bridge = Node(package='ros_gz_bridge', executable='parameter_bridge', output='screen',
                           arguments=['--ros-args', '-p', f'config_file:={bridge_params}'])
    contact_bridge = Node(
        package='ros_gz_bridge', executable='parameter_bridge', output='screen',
        arguments=contact_bridge_arguments(),
    )
    resources = AppendEnvironmentVariable(
        'GZ_SIM_RESOURCE_PATH', os.path.join(gazebo_share, 'models'))

    return LaunchDescription([gzserver, spawn, state_publisher, standard_bridge, contact_bridge, resources])
