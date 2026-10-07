import math
from types import SimpleNamespace as Namespace

from did_judge.gazebo_pose import extract_robot_pose, yaw_of_quaternion


def entity(name, x, y, z_quaternion=0.0, w_quaternion=1.0):
    return Namespace(name=name, position=Namespace(x=x, y=y),
                     orientation=Namespace(x=0.0, y=0.0, z=z_quaternion, w=w_quaternion))


def test_picks_robot_root_among_other_entities():
    message = Namespace(pose=[entity("ground_plane", 0, 0), entity("burger", -2.011, -0.5),
                              entity("base_link", 0, 0)])
    assert extract_robot_pose(message) == (-2.011, -0.5, 0.0)


def test_missing_robot_gives_none():
    assert extract_robot_pose(Namespace(pose=[entity("ground_plane", 0, 0)])) is None


def test_yaw_from_quaternion_for_quarter_turn():
    half = math.sqrt(0.5)
    assert abs(yaw_of_quaternion(0.0, 0.0, half, half) - math.pi / 2) < 1e-9
