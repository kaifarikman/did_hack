"""Запуск turtlebot3_world без GUI: сервер Gazebo, робот, мост ROS-Gazebo.

Повторяет официальный turtlebot3_world.launch.py, но не стартует gzclient,
которому нужен дисплей. Позиция спавна по умолчанию — (-2.0, -0.5), как в пакете.
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    gazebo_share = get_package_share_directory('turtlebot3_gazebo')
    launch_dir = os.path.join(gazebo_share, 'launch')
    ros_gz_sim = get_package_share_directory('ros_gz_sim')
    world = os.path.join(gazebo_share, 'worlds', 'turtlebot3_world.world')

    gzserver = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(ros_gz_sim, 'launch', 'gz_sim.launch.py')),
        launch_arguments={'gz_args': ['-r -s -v2 ', world], 'on_exit_shutdown': 'true'}.items(),
    )
    robot_state_publisher = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(launch_dir, 'robot_state_publisher.launch.py')),
        launch_arguments={'use_sim_time': 'true'}.items(),
    )
    spawn = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(launch_dir, 'spawn_turtlebot3.launch.py')),
        launch_arguments={
            'x_pose': LaunchConfiguration('x_pose', default='-2.0'),
            'y_pose': LaunchConfiguration('y_pose', default='-0.5'),
        }.items(),
    )
    resources = AppendEnvironmentVariable(
        'GZ_SIM_RESOURCE_PATH', os.path.join(gazebo_share, 'models'))

    return LaunchDescription([gzserver, spawn, robot_state_publisher, resources])
