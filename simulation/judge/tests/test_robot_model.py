import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                "scripts"))
from robot_model import bridge_arguments, default_bases, namespaced_sdf  # noqa: E402

SOURCE = """<sdf><model name="turtlebot3_burger">
<topic>imu</topic><topic>scan</topic><gz_frame_id>base_scan</gz_frame_id>
<topic>cmd_vel</topic><odom_topic>odom</odom_topic><frame_id>odom</frame_id>
<child_frame_id>base_footprint</child_frame_id><tf_topic>/tf</tf_topic>
<topic>joint_states</topic></model></sdf>"""


def test_all_topics_and_frames_get_robot_prefix():
    result = namespaced_sdf(SOURCE, "robot_2")
    for expected in ("<model name=\"robot_2\">", "<topic>robot_2/cmd_vel</topic>", "<topic>robot_2/scan</topic>",
                     "<odom_topic>robot_2/odom</odom_topic>", "<frame_id>robot_2/odom</frame_id>",
                     "<child_frame_id>robot_2/base_footprint</child_frame_id>",
                     "<tf_topic>/robot_2/tf</tf_topic>", "<gz_frame_id>robot_2/base_scan</gz_frame_id>"):
        assert expected in result


def test_changed_source_model_is_rejected():
    with pytest.raises(ValueError):
        namespaced_sdf(SOURCE.replace("<topic>imu</topic>", ""), "robot_1")


def test_two_robots_do_not_share_topics():
    first, second = namespaced_sdf(SOURCE, "robot_1"), namespaced_sdf(SOURCE, "robot_2")
    assert "robot_2/" not in first and "robot_1/" not in second


def test_bridge_remaps_robot_tf_to_common_tf():
    arguments = bridge_arguments("robot_1")
    assert "/robot_1/cmd_vel@geometry_msgs/msg/TwistStamped]gz.msgs.Twist" in arguments
    assert arguments[-2:] == ["-r", "/robot_1/tf:=/tf"]


def test_default_bases_are_distinct_and_start_pads_free(grid, config):
    bases = default_bases(2)
    assert bases["robot_1"] == (-2.0, -0.5) and bases["robot_2"] == (-2.0, 0.5)
    safe = grid.inflated(config.robot_radius_m + config.placement_margin_m)
    for base in bases.values():
        assert safe.is_free(*safe.cell_of(*base))


def test_judge_bases_match_spawn_positions():
    from did_judge.team import default_robot_bases
    spawned = default_bases(2)
    assert default_robot_bases(list(spawned), (-2.0, -0.5)) == spawned
