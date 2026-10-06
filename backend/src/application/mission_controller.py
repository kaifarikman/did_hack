"""Контроллер одного прогона: тик за тиком ведёт миссию через порты.

Приоритеты каждого тика: Stop → свежесть наблюдений → батарея → запас на возврат → решение планировщика.
"""
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass

from application.motion import MotionExecutor, MotionState
from application.navigation_service import NavigationService
from application.ports import (
    Clock, JournalStore, JudgeClient, ObservationSource, Planner, PlannerError, SimulationControl,
)
from application.validation import GoalVerdict, validate_subgoal
from domain.energy import TerrainEstimator, TravelSegment
from domain.errors import InvalidTransition
from domain.geometry import Point, distance_m, normalize_angle
from domain.hypotheses import Hypothesis, HypothesisBook, HypothesisStatus
from domain.journal import JournalDraft, JournalKind
from domain.mission import Mission, MissionError, TerrainEstimateView
from domain.observations import Observation
from domain.policy import decide_subgoal
from domain.search import SignalSearch
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, PlanningContext, Subgoal, TerrainView

STARTUP_OBSERVATION_GRACE_S = 5.0
RETURN_ESTIMATE_REFRESH_M = 0.25


@dataclass
class ControllerPorts:
    observations: ObservationSource
    motion: MotionExecutor
    judge: JudgeClient
    simulation: SimulationControl
    planner: Planner
    journal: JournalStore
    navigation: NavigationService
    clock: Clock


class MissionController:
    def __init__(
        self,
        mission: Mission,
        ports: ControllerPorts,
        settings: MissionSettings,
        estimator: TerrainEstimator,
        search: SignalSearch,
        hypotheses: HypothesisBook,
    ) -> None:
        self._mission = mission
        self._ports = ports
        self._settings = settings
        self._estimator = estimator
        self._search = search
        self._hypotheses = hypotheses
        self._goal: Subgoal | None = None
        self._planner_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="planner")
        self._pending_proposal: Future[Subgoal] | None = None
        self._replans = 0
        self._decisions = 0
        self._reset_done_at_s: float | None = None
        self._simulation_time_s: float | None = None
        self._segment_reset: Point | None = None
        self._segment = _SegmentAccumulator()
        self._return_estimate: float | None = None
        self._return_estimate_at: Point | None = None
        self._return_estimate_revision = -1
        self._published_terrain_revision = -1

    # ---------------------------------------------------------------- tick

    def tick(self) -> None:
        mission = self._mission
        if mission.status.is_terminal:
            return
        if mission.stop_requested:
            self._finish_stop()
            return
        if mission.status.value == "starting":
            self._reset_and_start()
            return
        observation = self._fresh_observation()
        if observation is None:
            return
        self._ingest(observation)
        pose = observation.pose
        motion_state = self._ports.motion.step(pose, self._ports.clock.monotonic_s())
        if motion_state is MotionState.MOVING:
            self._enforce_reserve(observation)
        elif motion_state is MotionState.ARRIVED:
            self._on_arrival(observation)
        elif motion_state is MotionState.STUCK:
            self._on_stuck(observation)
        else:
            self._decide(observation)

    # ------------------------------------------------------------ lifecycle

    def _log(self, kind: JournalKind, title: str, detail: str, **fields) -> None:
        self._ports.journal.append(
            self._mission.run_id,
            JournalDraft(kind, title, detail, self._simulation_time_s, **fields),
        )

    def _reset_and_start(self) -> None:
        self._ports.motion.stop()
        try:
            self._ports.simulation.reset(self._mission.scenario, self._mission.seed)
        except Exception as error:  # отказ сброса любого рода: робот остановлен, прогон failed
            self._ports.motion.stop()
            self._fail("reset_failed", f"Сброс симуляции не удался: {error}", retryable=True)
            return
        self._reset_done_at_s = self._ports.clock.monotonic_s()
        if self._mission.stop_requested:
            self._finish_stop()
            return
        try:
            self._mission.mark_running()
        except InvalidTransition:
            self._finish_stop()
            return
        self._log(
            JournalKind.DECISION, "Начало миссии",
            f"Сценарий {self._mission.scenario}, seed {self._mission.seed}, судья {self._settings.judge_mode}.",
        )

    def _finish_stop(self) -> None:
        self._pending_proposal = None
        self._ports.motion.stop()
        self._goal = None
        try:
            self._mission.confirm_stopped()
        except InvalidTransition:
            return
        self._mission.set_goal(None)
        self._log(JournalKind.DECISION, "Миссия остановлена", "Stop прервал исполнение; это не успешное завершение.")

    def abort(self, message: str) -> None:
        self._fail("internal_error", message)

    def _fail(self, code: str, message: str, retryable: bool = False) -> None:
        self._ports.motion.stop()
        self._mission.fail(MissionError(code, message, retryable))
        self._mission.set_goal(None)
        self._log(JournalKind.ERROR, code, message)

    def _fresh_observation(self) -> Observation | None:
        clock = self._ports.clock
        observation = self._ports.observations.latest()
        started = self._reset_done_at_s or clock.monotonic_s()
        from_previous_run = observation is not None and observation.received_monotonic_s < started
        if observation is None or from_previous_run:
            self._ports.motion.stop()
            if clock.monotonic_s() - started > STARTUP_OBSERVATION_GRACE_S:
                self._fail("observations_stale", "Нет свежих наблюдений после сброса.", True)
            return None
        if clock.monotonic_s() - observation.received_monotonic_s > self._settings.observation_max_age_s:
            self._fail("observations_stale", "Наблюдения устарели; движение остановлено.", True)
            return None
        if observation.pose is None or observation.battery_remaining is None:
            self._fail("observations_incomplete", "Нет позы или батареи.", True)
            return None
        if observation.battery_remaining <= 0:
            self._fail("battery_depleted", "Батарея исчерпана.")
            return None
        return observation

    # ------------------------------------------------------------ ingestion

    def _ingest(self, observation: Observation) -> None:
        self._simulation_time_s = observation.simulation_time_s
        pose = observation.pose
        self._mission.update_telemetry(
            observation.simulation_time_s, pose, observation.battery_remaining, observation.sample_signal
        )
        if observation.sample_signal is not None:
            self._search.record_signal(pose.point, observation.sample_signal)
        segment = self._segment.add(observation, self._ports.clock.monotonic_s(), self._settings)
        if segment is not None:
            self._estimator.record(segment)
        if self._estimator.revision != self._published_terrain_revision:
            self._published_terrain_revision = self._estimator.revision
            self._mission.set_terrain(
                tuple(
                    TerrainEstimateView(region_id, center, radius, energy, confidence)
                    for region_id, center, radius, energy, confidence in self._estimator.regions()
                )
            )
        self._refresh_return_estimate(observation)

    def _refresh_return_estimate(self, observation: Observation) -> None:
        position = observation.pose.point
        moved = (
            self._return_estimate_at is None
            or distance_m(position, self._return_estimate_at) >= RETURN_ESTIMATE_REFRESH_M
            or self._estimator.revision != self._return_estimate_revision
        )
        if not moved:
            return
        self._return_estimate = self._ports.navigation.return_energy(position)
        self._return_estimate_at = position
        self._return_estimate_revision = self._estimator.revision
        self._mission.set_return_estimate(self._return_estimate)

    def _return_estimate_or_conservative(self, position: Point) -> float:
        """Неизвестная оценка не равна нулю: берём прямое расстояние с запасом и prior."""
        if self._return_estimate is not None:
            return self._return_estimate
        straight = distance_m(position, self._settings.base) * 1.5
        return straight * self._estimator.prior_energy_per_m * self._settings.return_safety_factor

    def _reserve_low(self, observation: Observation) -> bool:
        needed = self._return_estimate_or_conservative(observation.pose.point) + self._settings.return_reserve
        return observation.battery_remaining < needed

    # -------------------------------------------------------------- events

    def _enforce_reserve(self, observation: Observation) -> None:
        if self._goal is not None and self._goal.kind is GoalKind.RETURN:
            return
        if not self._reserve_low(observation):
            return
        self._ports.motion.stop()
        self._goal = None
        self._log(
            JournalKind.DECISION, "Возврат по запасу энергии",
            "Проверка запаса имеет приоритет над решением планировщика: "
            f"батарея {observation.battery_remaining:.1f}, оценка возврата {self._return_estimate_or_conservative(observation.pose.point):.1f}.",
        )
        self._apply_goal(
            observation, Subgoal(GoalKind.RETURN, self._settings.base, "Запас энергии на возврат на пределе.")
        )

    def _on_arrival(self, observation: Observation) -> None:
        goal, self._goal = self._goal, None
        self._replans = 0
        if goal is None:
            return
        if goal.kind is GoalKind.RETURN:
            self._finish_mission(observation)
        elif goal.hypothesis_id is not None:
            self._conclude_experiment(goal.hypothesis_id)

    def _on_stuck(self, observation: Observation) -> None:
        self._replans += 1
        goal = self._goal
        self._log(
            JournalKind.ERROR, "Нет прогресса",
            f"Застревание на пути к {goal.kind.value if goal else 'цели'}, попытка {self._replans}.",
        )
        if goal is None:
            return
        if self._replans > self._settings.max_replans:
            if goal.kind is GoalKind.RETURN:
                self._fail("stuck_returning", "Робот застрял при возврате на базу.")
                return
            self._goal = None
            self._replans = 0
            return
        verdict = self._verdict(observation, goal)
        if verdict.accepted:
            self._start_route(observation, goal, verdict)
        elif goal.kind is GoalKind.RETURN:
            self._fail("no_route_home", "Маршрут на базу не найден.")
        else:
            self._goal = None

    def _finish_mission(self, observation: Observation) -> None:
        reply = self._ports.judge.finish()
        mission = self._mission
        if mission.samples_collected == 0:
            self._fail("no_confirmed_sample", "Возврат без подтверждённого образца; успех не засчитан.")
            return
        try:
            mission.complete(reply.success)
        except InvalidTransition as error:
            self._fail("finish_rejected", f"Завершение не принято: {error}. {reply.message}".strip())
            return
        mission.set_goal(None)
        self._log(
            JournalKind.OUTCOME, "Миссия завершена",
            f"Судья подтвердил возврат; образцов: {mission.samples_collected}, "
            f"батарея {observation.battery_remaining:.1f}.",
        )

    # ------------------------------------------------------------ decisions

    def _verdict(self, observation: Observation, goal: Subgoal) -> GoalVerdict:
        if goal.kind is GoalKind.COLLECT:
            if self._search.total_collect_attempts >= self._settings.max_collect_attempts:
                return GoalVerdict(False, "исчерпан общий лимит неудачных попыток сбора")
            if self._search.collect_attempts_near(observation.pose.point) >= 2:
                return GoalVerdict(False, "исчерпан лимит попыток сбора в этой области")
        return validate_subgoal(
            goal, observation.pose.point, observation.battery_remaining, observation.sample_signal,
            self._ports.navigation, self._settings,
        )

    def _build_context(self, observation: Observation) -> PlanningContext:
        pose = observation.pose
        navigation = self._ports.navigation
        candidates = self._search.rank_candidates(
            navigation.lattice_points(pose.point), pose.point,
            self._settings.candidate_min_distance_m, self._settings.candidate_max_distance_m,
        )
        tail = self._ports.journal.tail(self._mission.run_id, 5)
        return PlanningContext(
            run_id=self._mission.run_id,
            pose=pose,
            base=self._settings.base,
            battery_remaining=observation.battery_remaining,
            battery_initial=self._settings.battery_initial,
            sample_signal=observation.sample_signal,
            best_signal=self._search.best_signal,
            samples_collected=self._mission.samples_collected,
            return_energy_estimate=self._return_estimate,
            reserve_low=self._reserve_low(observation),
            decisions_made=self._decisions,
            decisions_since_improvement=self._search.decisions_since_improvement,
            collect_attempts_here=self._search.collect_attempts_near(pose.point),
            total_collect_attempts=self._search.total_collect_attempts,
            candidates=tuple(candidates),
            terrain=tuple(
                TerrainView(center, radius, energy, confidence)
                for _, center, radius, energy, confidence in self._estimator.regions()
            ),
            recent_signals=self._search.recent_signals(),
            journal_tail=tuple(f"{entry.draft.title}: {entry.draft.detail}" for entry in tail),
        )

    def _decide(self, observation: Observation) -> None:
        mission = self._mission
        if mission.status.value == "returning":
            self._decisions += 1
            self._search.note_decision()
            self._apply_goal(
                observation, Subgoal(GoalKind.RETURN, self._settings.base, "Продолжаем возврат на базу.")
            )
            return
        if self._reserve_low(observation):
            self._pending_proposal = None
            self._enforce_reserve(observation)
            return
        if self._pending_proposal is None:
            self._decisions += 1
            self._search.note_decision()
            if self._try_experiment(observation):
                return
        context = self._build_context(observation)
        proposed = self._await_proposal(context)
        if proposed is None:
            return  # планировщик ещё думает: тик не блокируется, Stop и контроль наблюдений продолжают работать
        if self._is_cancelled():
            return  # устаревший ответ после Stop игнорируется
        alternatives = [
            Subgoal(
                GoalKind.APPROACH if (context.best_signal or 0) >= self._settings.approach_signal_threshold
                else GoalKind.EXPLORE,
                candidate.point, "Резервная цель после отказа исполнителя.",
            )
            for candidate in context.candidates
        ]
        base_goal = Subgoal(GoalKind.RETURN, self._settings.base, "Возврат: другие цели недопустимы.")
        for goal in [proposed, *alternatives, base_goal]:
            verdict = self._verdict(observation, goal)
            if verdict.accepted:
                self._apply_goal(observation, goal, verdict)
                return
            self._log(
                JournalKind.DECISION, "Подцель отклонена исполнителем",
                f"{goal.kind.value}: {verdict.reason}. Источник: {goal.source}.",
            )
        self._fail("no_valid_goal", "Ни одна подцель, включая возврат, не допустима.")

    def _is_cancelled(self) -> bool:
        return self._mission.stop_requested or self._mission.status.is_terminal

    def _propose(self, context: PlanningContext) -> Subgoal:
        try:
            return self._ports.planner.propose(context, self._is_cancelled)
        except PlannerError as error:
            fallback = decide_subgoal(context, self._settings)
            return Subgoal(fallback.kind, fallback.target, f"{fallback.reason} (fallback: {error})")

    def _await_proposal(self, context: PlanningContext) -> Subgoal | None:
        """Запрос к планировщику идёт в фоне; None — ответа ещё нет."""
        if self._pending_proposal is None:
            self._pending_proposal = self._planner_pool.submit(self._propose, context)
        if not self._pending_proposal.done():
            return None
        proposal, self._pending_proposal = self._pending_proposal.result(), None
        return proposal

    def _apply_goal(
        self, observation: Observation, goal: Subgoal, verdict: GoalVerdict | None = None
    ) -> None:
        if goal.kind is GoalKind.COLLECT:
            self._collect(observation, goal)
            return
        verdict = verdict or self._verdict(observation, goal)
        if not verdict.accepted:
            if goal.kind is GoalKind.RETURN:
                self._fail("no_route_home", f"Возврат невозможен: {verdict.reason}")
            return
        self._start_route(observation, goal, verdict)

    def _start_route(self, observation: Observation, goal: Subgoal, verdict: GoalVerdict) -> None:
        mission = self._mission
        if goal.kind is GoalKind.RETURN:
            mission.begin_return()
        self._goal = goal
        mission.set_goal(goal, verdict.route.waypoints)
        self._ports.motion.follow(list(verdict.route.waypoints))
        self._log(
            JournalKind.DECISION, f"Подцель: {goal.kind.value}",
            f"{goal.reason} Источник: {goal.source}. Расход по маршруту ≈ {verdict.route.energy:.1f}, "
            f"оценка возврата {self._return_estimate_or_conservative(observation.pose.point):.1f} "
            f"(по {len(self._estimator.measured_buckets())} измеренным участкам).",
            hypothesis_id=goal.hypothesis_id,
        )

    def _collect(self, observation: Observation, goal: Subgoal) -> None:
        self._ports.motion.stop()
        self._mission.set_goal(goal)
        reply = self._ports.judge.collect()
        position = observation.pose.point
        if reply.success:
            sample = self._mission.add_collected_sample(position)
            self._search.reset_after_collect()
            self._log(
                JournalKind.OUTCOME, "Образец собран",
                f"{sample.sample_id}: подтверждён судьёй в точке ({position.x_m:.2f}, {position.y_m:.2f}).",
            )
        else:
            self._search.record_collect_attempt(position)
            self._log(
                JournalKind.OUTCOME, "Сбор не удался",
                f"Судья отклонил попытку при сигнале {observation.sample_signal}; поиск уточняется. {reply.message}".strip(),
            )
        self._goal = None

    # ----------------------------------------------------------- experiment

    def _try_experiment(self, observation: Observation) -> bool:
        book = self._hypotheses
        hypothesis = book.active()
        if hypothesis is None:
            hypothesis = book.propose(self._estimator)
            if hypothesis is not None:
                self._log(
                    JournalKind.HYPOTHESIS, "Участок с повышенным расходом",
                    f"Корзина {hypothesis.bucket} дороже базовой линии {hypothesis.baseline_energy_per_m:.2f} ед./м.",
                    hypothesis_id=hypothesis.hypothesis_id,
                    expected=f"Повторный проезд даст расход ≥ {1.3 * hypothesis.baseline_energy_per_m:.2f} ед./м.",
                    observed=f"Первичная оценка {hypothesis.observed_energy_per_m:.2f} ед./м.",
                )
        if hypothesis is None or hypothesis.status is HypothesisStatus.DEFERRED:
            return False
        goal = self._experiment_goal(observation, hypothesis)
        verdict = self._verdict(observation, goal) if goal else GoalVerdict(False, "нет цели")
        if not verdict.accepted:
            book.defer(hypothesis)
            self._log(
                JournalKind.EXPERIMENT, "Эксперимент отложен",
                f"Недостаточно энергии или нет маршрута: {verdict.reason}. Вывод не делается.",
                hypothesis_id=hypothesis.hypothesis_id, expected="Проверочный проезд через участок.",
            )
            return False
        book.start_experiment(hypothesis, self._estimator)
        self._log(
            JournalKind.EXPERIMENT, "Проверочный проезд",
            "Безопасный проезд через участок с сохранением запаса возврата.",
            hypothesis_id=hypothesis.hypothesis_id,
            expected=f"Расход ≥ {1.3 * hypothesis.baseline_energy_per_m:.2f} ед./м.",
        )
        self._apply_goal(observation, goal, verdict)
        return True

    def _experiment_goal(self, observation: Observation, hypothesis: Hypothesis) -> Subgoal | None:
        """Цель за участком: проезд насквозь даёт достаточную дистанцию для измерения."""
        robot = observation.pose.point
        center = hypothesis.center
        length = distance_m(robot, center)
        navigation = self._ports.navigation
        if length > 0.05:
            beyond = Point(
                center.x_m + (center.x_m - robot.x_m) / length * 0.5,
                center.y_m + (center.y_m - robot.y_m) / length * 0.5,
            )
            if navigation.is_reachable(beyond):
                center = beyond
        return Subgoal(
            GoalKind.EXPLORE, center, "Проверка гипотезы о стоимости грунта.",
            hypothesis_id=hypothesis.hypothesis_id,
        )

    def _conclude_experiment(self, hypothesis_id: str) -> None:
        book = self._hypotheses
        hypothesis = next((h for h in book.items if h.hypothesis_id == hypothesis_id), None)
        if hypothesis is None:
            return
        status = book.evaluate(hypothesis, self._estimator)
        if status is None:
            status = book.give_up_or_retry(hypothesis)
            self._log(
                JournalKind.OUTCOME, "Измерение не получено",
                "Проезд не дал достаточной чистой дистанции; гипотеза остаётся непроверенной.",
                hypothesis_id=hypothesis_id,
                conclusion=None,
            )
            return
        self._log(
            JournalKind.OUTCOME, "Гипотеза проверена",
            "Сравнение ожидания с измерением.",
            hypothesis_id=hypothesis_id,
            expected=f"≥ {1.3 * hypothesis.baseline_energy_per_m:.2f} ед./м",
            observed=f"{hypothesis.measured_energy_per_m:.2f} ед./м",
            conclusion=(
                "Подтверждено: участок дорогой, маршруты и запас возврата учитывают оценку."
                if status is HypothesisStatus.CONFIRMED
                else "Опровергнуто: повышенный расход не воспроизведён, оценка пересмотрена."
            ),
        )


class _SegmentAccumulator:
    """Копит пройденный путь и падение батареи до отрезка, пригодного для оценки грунта."""

    IDLE_STEP_M = 0.005
    MAX_IDLE_S = 1.0

    def __init__(self) -> None:
        self._last: Observation | None = None
        self._last_time_s = 0.0
        self._reset(None, 0.0)

    def _reset(self, observation: Observation | None, now_s: float) -> None:
        self._start = observation
        self._start_time_s = now_s
        self._distance = 0.0
        self._rotation = 0.0
        self._idle_s = 0.0
        self._penalty = False

    def add(self, observation: Observation, now_s: float, settings: MissionSettings) -> TravelSegment | None:
        if self._start is None:
            self._reset(observation, now_s)
            self._last, self._last_time_s = observation, now_s
            return None
        step = distance_m(self._last.pose.point, observation.pose.point)
        self._distance += step
        self._rotation += abs(normalize_angle(observation.pose.heading_rad - self._last.pose.heading_rad))
        if step < self.IDLE_STEP_M:
            self._idle_s += now_s - self._last_time_s
        self._penalty = self._penalty or observation.penalty_recent
        self._last, self._last_time_s = observation, now_s
        if self._distance < 0.3:
            return None
        segment = TravelSegment(
            start=self._start.pose.point,
            end=observation.pose.point,
            distance_m=self._distance,
            battery_drop=self._start.battery_remaining - observation.battery_remaining,
            duration_s=now_s - self._start_time_s,
            rotation_rad=self._rotation,
            penalty_flagged=self._penalty or self._idle_s > self.MAX_IDLE_S,
        )
        self._reset(observation, now_s)
        return segment
