"""Исследование среды: измерения расхода, модель грунта и жизненный цикл гипотез.

Контроллер миссии остаётся единственным владельцем состояния прогона и исполнения; этот модуль
владеет моделью среды. Он не отдаёт команд движения и не вызывает судью: возвращает записи
журнала и предложения эксперимента, которые контроллер проверяет и исполняет.
"""
from __future__ import annotations

from dataclasses import dataclass

from application.segments import SegmentAccumulator
from domain.energy import TerrainEstimator
from domain.geometry import Point, distance_m
from domain.hypotheses import Hypothesis, HypothesisBook, HypothesisStatus
from domain.journal import JournalDraft, JournalKind
from domain.mission import TerrainEstimateView
from domain.observations import Observation
from domain.subgoals import GoalKind, Subgoal


@dataclass(frozen=True)
class ExperimentProposal:
    hypothesis: Hypothesis
    goal: Subgoal


class TerrainResearch:
    def __init__(
        self, estimator: TerrainEstimator, hypotheses: HypothesisBook,
        accumulator: SegmentAccumulator | None = None,
    ) -> None:
        self._estimator = estimator
        self._hypotheses = hypotheses
        self._segments = accumulator or SegmentAccumulator()
        self._simulation_time_s: float | None = None

    @property
    def revision(self) -> int:
        return self._estimator.revision

    @property
    def estimator(self) -> TerrainEstimator:
        return self._estimator

    def _draft(self, kind: JournalKind, title: str, detail: str, **fields) -> JournalDraft:
        return JournalDraft(kind, title, detail, self._simulation_time_s, **fields)

    # ------------------------------------------------------------ измерения

    def observe(self, observation: Observation, monotonic_s: float, penalty: bool) -> list[JournalDraft]:
        self._simulation_time_s = observation.simulation_time_s
        segment = self._segments.add(observation, monotonic_s, penalty)
        if segment is not None:
            self._estimator.record(segment)
        return []

    def discard_segment(self) -> None:
        self._segments.discard()

    def terrain_views(self) -> tuple[TerrainEstimateView, ...]:
        return tuple(
            TerrainEstimateView(
                region_id, self._estimator.bucket_center(bucket), self._estimator.bucket_size_m / 2,
                estimate.energy_per_m, estimate.confidence, estimate.std_energy_per_m, estimate.regime,
                estimate.last_measured_s,
            )
            for region_id, bucket, estimate in self._estimator.detailed_regions()
        )

    # ------------------------------------------------------------ гипотезы

    def proposal(self, robot: Point, is_reachable) -> tuple[ExperimentProposal | None, list[JournalDraft]]:
        """Активная или новая гипотеза и цель проверочного проезда; None — экспериментировать нечего."""
        book, notes = self._hypotheses, []
        hypothesis = book.active()
        if hypothesis is None:
            hypothesis = book.propose(self._estimator)
            if hypothesis is not None:
                notes.append(self._draft(
                    JournalKind.HYPOTHESIS, "Участок с повышенным расходом",
                    f"Корзина {hypothesis.bucket} дороже базовой линии {hypothesis.baseline_energy_per_m:.2f} ед./м.",
                    hypothesis_id=hypothesis.hypothesis_id,
                    expected=f"Повторный проезд даст расход ≥ {book.confirm_threshold(hypothesis):.2f} ед./м.",
                    observed=f"Первичная оценка {hypothesis.observed_energy_per_m:.2f} ед./м.",
                ))
        if hypothesis is None or hypothesis.status is HypothesisStatus.DEFERRED:
            return None, notes
        return ExperimentProposal(hypothesis, self._experiment_goal(robot, hypothesis, is_reachable)), notes

    def _experiment_goal(self, robot: Point, hypothesis: Hypothesis, is_reachable) -> Subgoal:
        """Цель за участком: проезд насквозь даёт достаточную дистанцию для измерения."""
        center = hypothesis.center
        length = distance_m(robot, center)
        if length > 0.05:
            beyond = Point(
                center.x_m + (center.x_m - robot.x_m) / length * 0.5,
                center.y_m + (center.y_m - robot.y_m) / length * 0.5,
            )
            if is_reachable(beyond):
                center = beyond
        return Subgoal(
            GoalKind.EXPLORE, center, "Проверка гипотезы о стоимости грунта.",
            hypothesis_id=hypothesis.hypothesis_id,
        )

    def defer(self, hypothesis: Hypothesis, reason: str) -> list[JournalDraft]:
        self._hypotheses.defer(hypothesis)
        return [self._draft(
            JournalKind.EXPERIMENT, "Эксперимент отложен",
            f"Недостаточно энергии или нет маршрута: {reason}. Вывод не делается.",
            hypothesis_id=hypothesis.hypothesis_id, expected="Проверочный проезд через участок.",
        )]

    def start(self, hypothesis: Hypothesis) -> list[JournalDraft]:
        self._hypotheses.start_experiment(hypothesis, self._estimator)
        return [self._draft(
            JournalKind.EXPERIMENT, "Проверочный проезд",
            "Безопасный проезд через участок с сохранением запаса возврата.",
            hypothesis_id=hypothesis.hypothesis_id,
            expected=f"Расход ≥ {self._hypotheses.confirm_threshold(hypothesis):.2f} ед./м.",
        )]

    def conclude(self, hypothesis_id: str) -> list[JournalDraft]:
        book = self._hypotheses
        hypothesis = next((item for item in book.items if item.hypothesis_id == hypothesis_id), None)
        if hypothesis is None:
            return []
        status = book.evaluate(hypothesis, self._estimator)
        if status is None:
            book.give_up_or_retry(hypothesis)
            return [self._draft(
                JournalKind.OUTCOME, "Измерение не получено",
                "Проезд не дал достаточной чистой дистанции; гипотеза остаётся непроверенной.",
                hypothesis_id=hypothesis_id, conclusion=None,
            )]
        return [self._draft(
            JournalKind.OUTCOME, "Гипотеза проверена", "Сравнение ожидания с измерением.",
            hypothesis_id=hypothesis_id,
            expected=f"≥ {book.confirm_threshold(hypothesis):.2f} ед./м",
            observed=f"{hypothesis.measured_energy_per_m:.2f} ед./м",
            conclusion=(
                "Подтверждено: участок дорогой, маршруты и запас возврата учитывают оценку."
                if status is HypothesisStatus.CONFIRMED
                else "Опровергнуто: повышенный расход не воспроизведён, оценка пересмотрена."
            ),
        )]
