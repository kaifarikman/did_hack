"""Regression: expired requests cannot occupy an ever-growing executor queue."""
from concurrent.futures import Future
from dataclasses import replace

from application.plan_execution import Chosen, PlanExecutor
from application.validation import GoalVerdict
from domain.settings import MissionSettings
from test_llm import context


class HeldExecutor:
    def __init__(self):
        self.jobs = []

    def submit(self, function, *arguments):
        future = Future()
        future.set_running_or_notify_cancel()
        self.jobs.append((future, function, arguments))
        return future


def test_deadline_cancels_request_and_does_not_queue_behind_running_call():
    clock = [0.0]
    executor = HeldExecutor()
    planner = PlanExecutor(object(), replace(MissionSettings(), planner_timeout_s=1, min_planner_interval_s=0),
                           executor, lambda *args, **kwargs: None, lambda: clock[0], lambda: False)
    build = lambda plan_id, epoch: context(plan_id=plan_id, model_epoch=epoch)
    accept = lambda goal: GoalVerdict(True, "allowed")
    planner.poll(build, accept)
    clock[0] = 2
    assert isinstance(planner.poll(build, accept), Chosen)
    planner.step_finished(True)
    assert isinstance(planner.poll(build, accept), Chosen)
    assert len(executor.jobs) == 1, "expired running request must not accumulate queued requests"
    assert planner.requests == 1


def test_cancel_propagates_to_running_planner_request():
    received = []
    class RecordingPlanner:
        def propose(self, planning_context, cancelled):
            received.append(cancelled())
            from domain.plans import single_step_plan
            from domain.subgoals import Subgoal, GoalKind
            return single_step_plan(planning_context, Subgoal(GoalKind.RETURN, planning_context.base, "test"), "test")
    executor = HeldExecutor()
    planner = PlanExecutor(RecordingPlanner(), MissionSettings(), executor,
                           lambda *args, **kwargs: None, lambda: 0, lambda: False)
    planner.poll(lambda plan_id, epoch: context(plan_id=plan_id, model_epoch=epoch), lambda goal: GoalVerdict(True, "ok"))
    planner.cancel()
    _, function, arguments = executor.jobs[0]
    function(*arguments)
    assert received == [True]


def test_stop_removes_a_request_that_has_not_started():
    class QueuedExecutor(HeldExecutor):
        def submit(self, function, *arguments):
            future = Future()
            self.jobs.append((future, function, arguments))
            return future
    executor = QueuedExecutor()
    planner = PlanExecutor(object(), MissionSettings(), executor, lambda *args, **kwargs: None,
                           lambda: 0, lambda: False)
    planner.poll(lambda plan_id, epoch: context(plan_id=plan_id, model_epoch=epoch),
                 lambda goal: GoalVerdict(True, "ok"))
    planner.cancel()
    assert executor.jobs[0][0].cancelled()
    assert not planner.waiting


def test_new_request_can_start_after_retired_worker_exits():
    clock = [0.0]
    executor = HeldExecutor()
    planner = PlanExecutor(object(), replace(MissionSettings(), planner_timeout_s=1, min_planner_interval_s=0),
                           executor, lambda *args, **kwargs: None, lambda: clock[0], lambda: False)
    build = lambda plan_id, epoch: context(plan_id=plan_id, model_epoch=epoch)
    accept = lambda goal: GoalVerdict(True, "ok")
    planner.poll(build, accept)
    clock[0] = 2
    planner.poll(build, accept)
    planner.step_finished(True)
    executor.jobs[0][0].set_result(None)
    planner.poll(build, accept)
    assert len(executor.jobs) == 2
    assert planner.waiting
