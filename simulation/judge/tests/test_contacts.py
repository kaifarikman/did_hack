from types import SimpleNamespace

from did_judge.contacts import has_obstacle_contact


def contact(first: str, second: str):
    return SimpleNamespace(collision1=SimpleNamespace(name=first),
                           collision2=SimpleNamespace(name=second))


def message(*contacts):
    return SimpleNamespace(contacts=list(contacts))


def test_robot_contact_with_world_obstacle_is_physical_collision():
    assert has_obstacle_contact(message(contact("burger::base_link::base_collision",
                                                "turtlebot3_world::wall::collision")), "burger")


def test_ground_contact_is_not_collision_penalty():
    ground = contact("burger::wheel_left_link::wheel_left_collision", "ground_plane::link::collision")
    assert not has_obstacle_contact(message(ground), "burger")


def test_other_robot_contact_is_attributed_to_correct_robot():
    collision = message(contact("robot_1::base_link::base_collision", "robot_2::base_link::base_collision"))
    assert has_obstacle_contact(collision, "robot_1")
    assert has_obstacle_contact(collision, "robot_2")


def test_lidar_proximity_without_contact_does_not_count():
    assert not has_obstacle_contact(message(), "burger")
    assert not has_obstacle_contact(message(contact("nearby_wall", "another_model")), "burger")
