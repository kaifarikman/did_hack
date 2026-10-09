"""Sample science owns evidence; the controller owns movement and search decisions."""
from domain.journal import JournalDraft, JournalKind
from domain.mission import HypothesisView
from domain.observations import Observation
from domain.sample_hypotheses import SampleHypothesis, sample_time
from domain.subgoals import GoalKind, Subgoal


class SampleResearch:
    def __init__(self) -> None:
        self.items: list[SampleHypothesis] = []
        self._serial = 0

    @property
    def active(self) -> SampleHypothesis | None:
        return next((item for item in reversed(self.items) if item.status == "testing"), None)

    def start(self, observation: Observation, goal: Subgoal, expected: float, sensor_usable: bool, monotonic_s: float):
        moment = sample_time(observation, monotonic_s)
        if (goal.kind not in (GoalKind.EXPLORE, GoalKind.APPROACH) or goal.target is None
                or goal.hypothesis_id is not None or moment is None or observation.sequence is None or not sensor_usable):
            return None, []
        self._serial += 1
        item = SampleHypothesis(f"sample-hypothesis-{self._serial}", goal.target, expected,
                                observation.sample_signal, observation, moment, monotonic_s)
        self.items.append(item)
        del self.items[:-32]
        return item, [
            JournalDraft(JournalKind.HYPOTHESIS, "Прогноз сигнала у цели", item.prediction,
                         observation.simulation_time_s, hypothesis_id=item.hypothesis_id,
                         expected=item.prediction, plan_id=goal.plan_id,
                         evidence=(f"observation-{observation.sequence}", f"prediction-monotonic-{monotonic_s}",
                                   f"robot-{observation.robot_id}", f"generation-{observation.generation}")),
            JournalDraft(JournalKind.EXPERIMENT, "Проверочный проезд", item.action,
                         observation.simulation_time_s, hypothesis_id=item.hypothesis_id,
                         experiment_id=item.experiment_id, expected=item.prediction, plan_id=goal.plan_id),
        ]

    def observe(self, observation: Observation, sensor_usable: bool, monotonic_s: float) -> None:
        if self.active is not None:
            self.active.observe(observation, sensor_usable, monotonic_s)

    def finish(self, moment: float | None, reason: str | None = None):
        item = self.active
        if item is None:
            return None, []
        item.finish(reason)
        return item, [JournalDraft(
            JournalKind.OUTCOME, "Результат проверки сигнала", item.conclusion,
            moment, hypothesis_id=item.hypothesis_id, expected=item.prediction,
            observed=item.measurement, conclusion=item.conclusion, experiment_id=item.experiment_id,
            evidence=tuple(f"sample-time-{time:.6f}-observation-{sequence}" for time, _, sequence in item.measurements),
        )]

    def views(self) -> tuple[HypothesisView, ...]:
        return tuple(HypothesisView(
            hypothesis_id=item.hypothesis_id, kind="sample_signal", status=item.status,
            center=item.center, prediction=item.prediction, measurement=item.measurement,
            detection_id=None, experiment_id=item.experiment_id,
            confirm_at_least=item.lower, confirm_at_most=item.upper,
            expected_signal=item.expected_signal, measured_signal=item.measured_signal,
            baseline_signal=item.baseline_signal, measurement_count=len(item.measurements),
            action=item.action, conclusion=item.conclusion,
        ) for item in self.items)
