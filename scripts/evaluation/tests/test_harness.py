import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from evaluation.harness import ApiClient, run_experiment, save_report  # noqa: E402

STILL = {"position_x_m": 0.0, "position_y_m": 0.0}


class ScriptedClient(ApiClient):
    def __init__(self, statuses, poses=None, reject=False):
        self.statuses = list(statuses)
        self.poses = list(poses or [])
        self.reject = reject
        self.stop_calls = 0
        self.journal_pages = [
            {"entries": [{"sequence": 1}], "next_sequence": 1, "has_more": True},
            {"entries": [{"sequence": 2}], "next_sequence": 2, "has_more": False}]

    def _snapshot(self):
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        pose = self.poses.pop(0) if self.poses else STILL
        return {"run_id": "r1", "status": status, "samples_collected": 2,
                "battery_remaining": 5.0, "robot_pose": pose}

    def start_run(self, request_id, scenario, seed):
        if self.reject:
            raise RuntimeError("HTTP 422")
        return self._snapshot()

    def stop_run(self, request_id, run_id):
        self.stop_calls += 1
        self.statuses = ["stopped"]

    def state(self):
        return self._snapshot()

    def journal_page(self, run_id, after_sequence):
        return self.journal_pages[0 if after_sequence == 0 else 1]


class FakeTime:
    def __init__(self):
        self.now = 0.0

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def run(client, timeout_s=100.0):
    fake = FakeTime()
    return run_experiment(client, "hard", 7, timeout_s, poll_interval_s=5.0,
                          clock=fake.clock, sleep=fake.sleep)


def test_completed_and_stationary_is_success_with_full_journal():
    report = run(ScriptedClient(["running", "returning", "completed"]))
    assert report.success and [entry["sequence"] for entry in report.journal] == [1, 2]


def test_completed_but_robot_still_moving_is_not_success():
    moved = {"position_x_m": 0.5, "position_y_m": 0.0}
    report = run(ScriptedClient(["running", "completed"], [STILL, STILL, moved]))
    assert report.outcome == "completed" and report.robot_stationary is False and not report.success


def test_timeout_stops_run_and_is_recorded():
    client = ScriptedClient(["running"])
    report = run(client, timeout_s=30.0)
    assert report.outcome == "timeout" and client.stop_calls == 1 and not report.success


def test_rejected_start_is_saved_as_result():
    report = run(ScriptedClient(["running"], reject=True))
    assert report.outcome == "start_rejected" and "422" in report.error


def test_failed_run_is_saved_to_disk(tmp_path):
    report = run(ScriptedClient(["failed"]))
    path = save_report(report, tmp_path)
    assert path.name == "hard-seed7-failed.json" and '"success": false' in path.read_text()
