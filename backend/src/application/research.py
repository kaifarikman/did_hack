"""Исследование среды: измерения, модель грунта, гипотезы, обнаружение изменений и состояние датчика.

Контроллер миссии остаётся единственным владельцем состояния прогона и исполнения; этот модуль
владеет моделью среды. Он не отдаёт команд движения и не вызывает судью: возвращает записи
журнала, предложения эксперимента и изменения модели, по которым контроллер перепланирует.
"""
from __future__ import annotations

from dataclasses import dataclass

from application.segments import SegmentAccumulator
from domain.change_detection import TerrainChangeDetector, TerrainShift
from domain.energy import Bucket, TerrainEstimator
from domain.events import PublicEvent
from domain.geometry import Point, distance_m
from domain.hazards import HazardMap, HazardSighting
from domain.hypotheses import Hypothesis, HypothesisBook, HypothesisKind, HypothesisStatus, describe_measurement
from domain.journal import JournalDraft, JournalKind
from domain.mission import TerrainEstimateView
from domain.observations import Observation
from domain.sensor_health import SensorHealthMonitor, SensorState
from domain.subgoals import GoalKind, Subgoal


@dataclass(frozen=True)
class ExperimentProposal:
    hypothesis: Hypothesis
    goal: Subgoal


@dataclass(frozen=True)
class ModelChange:
    """Изменение модели, способное сделать текущий маршрут или запас устаревшим."""

    detection_id: str
    cause: str
    bucket: Bucket | None = None
    hazard: HazardSighting | None = None


def _segments(sequences) -> tuple[str, ...]:
    return tuple(f"segment-{sequence}" for sequence in sequences)


class TerrainResearch:
    def __init__(
        self, estimator: TerrainEstimator, hypotheses: HypothesisBook,
        accumulator: SegmentAccumulator | None = None, detector: TerrainChangeDetector | None = None,
        hazards: HazardMap | None = None, sensor: SensorHealthMonitor | None = None,
    ) -> None:
        self._estimator = estimator
        self._hypotheses = hypotheses
        self._segments = accumulator or SegmentAccumulator()
        self._detector = detector or TerrainChangeDetector()
        self._hazards = hazards or HazardMap()
        self._sensor = sensor or SensorHealthMonitor()
        self._simulation_time_s: float | None = None
        self._changes: list[ModelChange] = []
        self._terrain_detections = 0
        self._hazard_hits = 0

    @property
    def revision(self) -> tuple[int, int]:
        """Версия модели: меняется при новых измерениях, смене режима и новых опасностях."""
        return self._estimator.revision, self._hazard_hits

    @property
    def estimator(self) -> TerrainEstimator:
        return self._estimator

    @property
    def hazards(self) -> HazardMap:
        return self._hazards

    @property
    def sensor(self) -> SensorHealthMonitor:
        return self._sensor

    @property
    def hypotheses(self) -> HypothesisBook:
        return self._hypotheses

    def take_changes(self) -> list[ModelChange]:
        changes, self._changes = self._changes, []
        return changes

    def _draft(self, kind: JournalKind, title: str, detail: str, **fields) -> JournalDraft:
        return JournalDraft(kind, title, detail, self._simulation_time_s, **fields)

    # ------------------------------------------------------------ измерения

    def observe(self, observation: Observation, monotonic_s: float, penalty: bool) -> list[JournalDraft]:
        self._simulation_time_s = observation.simulation_time_s
        notes = self._observe_sensor(observation, monotonic_s)
        segment = self._segments.add(observation, monotonic_s, penalty)
        if segment is None:
            return notes
        pieces, predicted = self._estimator.prediction_for(segment)
        residual_std = self._estimator.residual_std
        dominant = max(pieces, key=lambda piece: piece[1])[0] if pieces else None
        before = self._estimator.estimate_for_bucket(dominant) if dominant is not None else None
        record = self._estimator.record(segment)
        if record is None or before is None:
            return notes
        shift = self._detector.update(record, predicted, residual_std, before)
        if shift is not None:
            notes += self._on_terrain_shift(shift)
        return notes

    def _observe_sensor(self, observation: Observation, monotonic_s: float) -> list[JournalDraft]:
        time_s = observation.simulation_time_s if observation.simulation_time_s is not None else monotonic_s
        notes = []
        for change in self._sensor.update(observation.sample_signal, time_s):
            fault = change.fault.value if change.fault else "нет"
            if change.state is SensorState.SUSPECTED:
                title, kind = "Подозрение на неисправность датчика", JournalKind.HYPOTHESIS
            elif change.state is SensorState.DEGRADED:
                title, kind = "Неисправность датчика подтверждена", JournalKind.OBSERVATION
            elif change.state is SensorState.RECOVERING:
                title, kind = "Датчик восстанавливается", JournalKind.OBSERVATION
            else:
                title, kind = "Датчик в норме", JournalKind.OUTCOME
            notes.append(self._draft(
                kind, title, f"Состояние {change.state.value}, признак {fault}: {change.detail}.",
                detection_id=change.detection_id,
                expected="Шум ≈ 0.03, сообщения 5 Гц, значения меняются" if change.state is not SensorState.OK else None,
                observed=change.detail,
            ))
            if change.state in (SensorState.DEGRADED, SensorState.OK) and change.detection_id:
                self._changes.append(ModelChange(change.detection_id, f"датчик образцов: {change.state.value}"))
        return notes

    def note_collect(self) -> None:
        self._segments.discard()  # штраф/пауза сбора не относятся к стоимости грунта
        self._sensor.note_collect()

    def discard_segment(self) -> None:
        self._segments.discard()

    def _on_terrain_shift(self, shift: TerrainShift) -> list[JournalDraft]:
        self._terrain_detections += 1
        detection_id = f"terrain-{self._terrain_detections}"
        self._estimator.open_regime(shift.bucket, shift.first_sequence)
        hypothesis = self._hypotheses.propose_change(
            self._estimator, shift.bucket, shift.old_level, shift.new_level, shift.evidence, detection_id,
        )
        direction = "подорожал" if shift.rising else "подешевел"
        self._changes.append(ModelChange(detection_id, f"грунт в ячейке {shift.bucket} {direction}", bucket=shift.bucket))
        return [self._draft(
            JournalKind.HYPOTHESIS, f"Обнаружено изменение грунта: {direction}",
            f"Остатки прогноза в ячейке {shift.bucket} накопились (CUSUM {shift.statistic:.1f}). "
            "Открыт новый режим оценки: старые измерения ячейки больше не усредняются с новыми. "
            "Альтернативы — поворот и штраф — исключены моделью и отбором отрезков.",
            hypothesis_id=hypothesis.hypothesis_id, detection_id=detection_id,
            expected=f"прежний уровень {shift.old_level:.2f} ед./м",
            observed=f"новые отрезки дают ≈ {shift.new_level:.2f} ед./м",
            evidence=_segments(shift.evidence),
        )]

    def record_event(self, event: PublicEvent, robot_position: Point | None, localization_error_m: float | None
                     ) -> list[JournalDraft]:
        if event.kind.value != "hazard_hit":
            return []
        position = event.position or robot_position
        if position is None:
            return []
        self._hazard_hits += 1
        sighting, is_new = self._hazards.record_hit(position, event.simulation_time_s, localization_error_m or 0.0)
        self._changes.append(ModelChange(sighting.detection_id, "наблюдаемая опасность", hazard=sighting))
        title = "Наблюдаемая опасная область" if is_new else "Опасная область подтверждена повторно"
        return [self._draft(
            JournalKind.HYPOTHESIS if is_new else JournalKind.OBSERVATION, title,
            f"Событие hazard_hit №{event.sequence} в точке ({position.x_m:.2f}, {position.y_m:.2f}). "
            f"Граница неизвестна: обходим круг радиусом {sighting.radius_m:.2f} м, попаданий {sighting.hits}.",
            detection_id=sighting.detection_id, evidence=(f"event-{event.sequence}",),
        )]

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
                    f"Ячейка {hypothesis.bucket} дороже базовой линии {hypothesis.baseline_energy_per_m:.2f} ед./м. "
                    f"Альтернатива: {hypothesis.alternative}.",
                    hypothesis_id=hypothesis.hypothesis_id,
                    expected=f"Прогноз до проверки: {hypothesis.prediction.describe()}.",
                    observed=f"Первичная оценка {hypothesis.observed_energy_per_m:.2f} ед./м.",
                    evidence=_segments(hypothesis.evidence),
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
            GoalKind.EXPLORE, center, f"Проверка гипотезы {hypothesis.hypothesis_id}: проезд через ячейку {hypothesis.bucket}.",
            hypothesis_id=hypothesis.hypothesis_id,
        )

    def defer(self, hypothesis: Hypothesis, reason: str) -> list[JournalDraft]:
        self._hypotheses.defer(hypothesis)
        return [self._draft(
            JournalKind.EXPERIMENT, "Эксперимент отложен",
            f"Недостаточно энергии или нет маршрута: {reason}. Вывод не делается.",
            hypothesis_id=hypothesis.hypothesis_id, expected=hypothesis.prediction.describe(),
            detection_id=hypothesis.detection_id,
        )]

    def start(self, hypothesis: Hypothesis, route_energy: float) -> list[JournalDraft]:
        experiment_id = self._hypotheses.start_experiment(hypothesis, self._estimator)
        return [self._draft(
            JournalKind.EXPERIMENT, "Проверочный проезд",
            f"Безопасный проезд через ячейку {hypothesis.bucket} с сохранением запаса возврата; "
            f"бюджет ≈ {route_energy:.1f} ед. Учитываются только отрезки после начала проверки.",
            hypothesis_id=hypothesis.hypothesis_id, experiment_id=experiment_id,
            detection_id=hypothesis.detection_id,
            expected=f"Прогноз до действия: {hypothesis.prediction.describe()}.",
        )]

    def conclude(self, hypothesis_id: str) -> list[JournalDraft]:
        book = self._hypotheses
        hypothesis = book.find(hypothesis_id)
        if hypothesis is None:
            return []
        status = book.evaluate(hypothesis, self._estimator)
        common = dict(
            hypothesis_id=hypothesis_id, experiment_id=hypothesis.experiment_id,
            detection_id=hypothesis.detection_id, expected=hypothesis.prediction.describe(),
            observed=describe_measurement(hypothesis),
        )
        if status is None:
            status = book.give_up_or_retry(hypothesis)
            final = status is HypothesisStatus.UNVERIFIED
            return [self._draft(
                JournalKind.OUTCOME, "Недостаточно данных" if final else "Измерение не решающее",
                "Независимых измерений мало или они в пределах неопределённости от порога; "
                + ("лимит попыток исчерпан, вывод не делается." if final else "проверка будет повторена."),
                conclusion="Недостаточно данных: гипотеза не подтверждена и не опровергнута." if final else None,
                **common,
            )]
        confirmed = status is HypothesisStatus.CONFIRMED
        if hypothesis.kind is HypothesisKind.TERRAIN_CHANGE:
            if not confirmed:
                self._estimator.restore_previous_regime(hypothesis.bucket)
                self._detector.reset(hypothesis.bucket)
            conclusion = (
                "Подтверждено: новый режим грунта сохраняется; маршруты и запас возврата пересчитаны."
                if confirmed else
                "Опровергнуто: новые измерения согласуются с прежним уровнем; прежние измерения возвращены в оценку."
            )
        else:
            conclusion = (
                "Подтверждено измерениями: участок дорогой, маршруты обходят его, запас возврата учитывает оценку."
                if confirmed else "Опровергнуто: повышенный расход не воспроизведён, оценка пересмотрена."
            )
        return [self._draft(JournalKind.OUTCOME, "Гипотеза проверена", "Сравнение прогноза до действия с независимым измерением.",
                            conclusion=conclusion, **common)]
