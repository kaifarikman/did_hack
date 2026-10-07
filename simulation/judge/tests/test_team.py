import threading

import pytest

from did_judge.scenario import Scenario, SoilZone
from did_judge.team import TeamJudge

BASES = {"robot_1": (-2.0, -0.5), "robot_2": (-2.0, 0.5)}
SAMPLE = (0.0, 1.5)


@pytest.fixture
def team(config):
    scenario = Scenario(1, (SAMPLE, (1.0, 1.5)), (SoilZone((-1.0, -0.5), 0.5),))
    judge = TeamJudge(scenario, config, BASES)
    for robot_id, base in BASES.items():
        judge.update_pose(robot_id, base[0], base[1], 0.0, 0.0)
    return judge


def test_each_robot_has_own_battery(team):
    team.update_pose("robot_1", -1.8, -0.5, 0.0, 1.0)
    assert team.engines["robot_1"].battery < team.engines["robot_2"].battery


def test_sample_is_counted_once_when_both_collect_at_same_place(team):
    team.update_pose("robot_1", *SAMPLE, 0.0, 5.0)
    team.update_pose("robot_2", *SAMPLE, 0.0, 5.0)
    first, second = team.collect("robot_1"), team.collect("robot_2")
    summary = team.team_summary()
    assert first.success and not second.success
    assert summary["team_collected"] == 1 and summary["robots"]["robot_2"]["false_collects"] == 1


def test_concurrent_collects_never_double_count(team):
    team.update_pose("robot_1", *SAMPLE, 0.0, 5.0)
    team.update_pose("robot_2", *SAMPLE, 0.0, 5.0)
    results = []
    threads = [threading.Thread(target=lambda r=r: results.append(team.collect(r)))
               for r in ("robot_1", "robot_2")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sum(result.success for result in results) == 1 and team.samples_remaining == 1


def test_collected_sample_disappears_from_other_robots_signal(team):
    team.update_pose("robot_2", 1.0, 1.5, 0.0, 5.0)
    near = team.sample_signal("robot_2")
    team.update_pose("robot_1", 1.0, 1.5, 0.0, 5.0)
    assert team.collect("robot_1").success  # забрал образец (1.0, 1.5)
    assert team.sample_signal("robot_2") < near


def test_finish_is_per_robot_and_failure_is_not_masked(team):
    team.update_pose("robot_1", *BASES["robot_1"], 0.0, 6.0)
    team.update_pose("robot_2", 0.0, 0.0, 0.0, 6.0)  # далеко от своей базы
    assert team.finish("robot_1").success and not team.finish("robot_2").success
    summary = team.team_summary()
    assert not summary["all_finished_successfully"] and summary["failed_robots"] == ["robot_2"]


def test_robot_finishes_only_at_own_base(team):
    team.update_pose("robot_1", *BASES["robot_2"], 0.0, 6.0)  # на базе соседа
    assert not team.finish("robot_1").success


def test_depleted_robot_is_reported_but_other_keeps_running(team):
    team.engines["robot_1"].battery = 0.0
    summary = team.team_summary()
    assert summary["failed_robots"] == ["robot_1"] and summary["robots"]["robot_2"]["state"] == "running"


def test_unknown_robot_is_rejected(team):
    with pytest.raises(KeyError):
        team.collect("robot_9")
