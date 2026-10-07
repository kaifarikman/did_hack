"""Контроллер одного прогона: тик за тиком ведёт миссию через порты.

Приоритеты каждого тика: Stop → свежесть наблюдений → батарея → запас на возврат → решение планировщика.
"""
from __future__ import annotations

from concurrent.futures import Executor, Future, ThreadPoolExecutor
from dataclasses import dataclass

from application.event_feed import EventFeed
from application.motion import MotionExecutor, MotionState
from application.research import TerrainResearch
from application.navigation_service import NavigationService
from application.ports import (
    Clock, EventSource, JournalStore, JudgeClient, JudgeReply, MapMode, ObservationSource, OperationOutcome,
    Planner, PlannerError, ResetRequest, ScoreSource, SimulationControl,
)
from application.validation import GoalVerdict, validate_subgoal
from domain.errors import InvalidTransition
from domain.geometry import Point, distance_m
from domain.journal import JournalDraft, JournalKind
from domain.mission import Mission, MissionError
from domain.observations import DEFAULT_ROBOT_ID, LocalizationStatus, Observation
from domain.policy import decide_subgoal
from domain.target_selection import rank_by_utility
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
    events: EventSource | None = None
    score: ScoreSource | None = None
    map_mode: MapMode = MapMode.STATIC
    robot_id: str = DEFAULT_ROBOT_ID


class MissionController:
    def __init__(
        self,
        mission: Mission,
        ports: ControllerPorts,
        settings: MissionSettings,
        research: TerrainResearch,
        search: SignalSearch,
        planner_executor: Executor | None = None,
    ) -> None:
        self._mission = mission
        self._ports = ports
        self._settings = settings
        self._research = research
        self._estimator = research.estimator
        self._search = search
        self._goal: Subgoal | None = None
        # планировщик (LLM) отвечает в фоне, тик не ждёт его; тесты подставляют синхронный исполнитель
        self._planner_pool = planner_executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="planner")
        self._pending_proposal: Future[Subgoal] | None = None
        self._pending_context: PlanningContext | None = None
        self._replans = 0
        self._decisions = 0
        self._reset_done_at_s: float | None = None
        self._simulation_time_s: float | None = None
        self._return_estimate: float | None = None
        self._return_estimate_at: Point | None = None
        self._return_estimate_revision = -1
        self._published_terrain_revision = -1
        self._localization_lost_since_s: float | None = None
        self._events: EventFeed | None = None

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
        self._write(JournalDraft(kind, title, detail, self._simulation_time_s, **fields))

    def _write(self, *drafts: JournalDraft) -> None:
        for draft in drafts:
            self._ports.journal.append(self._mission.run_id, draft)

    def _reset_and_start(self) -> None:
        self._ports.motion.stop()
        request = ResetRequest(
            self._mission.scenario, self._mission.seed, self._mission.generation,
            self._ports.map_mode, (self._ports.robot_id,),
        )
        try:
            ack = self._ports.simulation.reset(request)
        except Exception as error:  # отказ сброса любого рода: робот остановлен, прогон failed
            self._ports.motion.stop()
            self._fail("reset_failed", f"Сброс симуляции не удался: {error}", retryable=True)
            return
        if not ack.matches(request):
            self._fail(
                "reset_mismatch",
                f"Среда подтвердила другой прогон: {ack.scenario}/{ack.seed}, поколение {ack.generation}.",
                retryable=True,
            )
            return
        self._reset_done_at_s = self._ports.clock.monotonic_s()
        if self._ports.events is not None:
            self._events = EventFeed(self._ports.events, self._mission.generation, self._ports.robot_id)
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
        from_previous_run = observation is not None and (
            observation.received_monotonic_s < started
            or (observation.generation is not None and observation.generation != self._mission.generation)
            or observation.robot_id != self._ports.robot_id
        )
        lost = observation is not None and observation.localization is LocalizationStatus.LOST
        if observation is None or from_previous_run or lost:
            self._ports.motion.stop()
            if lost:
                self._lose_localization()
            elif clock.monotonic_s() - started > STARTUP_OBSERVATION_GRACE_S:
                self._fail("observations_stale", "Нет свежих наблюдений после сброса.", True)
            return None
        self._localization_lost_since_s = None
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

    def _lose_localization(self) -> None:
        """Потеря позы — критический отказ движения: стоим и ждём восстановления ограниченное время."""
        now = self._ports.clock.monotonic_s()
        if self._localization_lost_since_s is None:
            self._localization_lost_since_s = now
            self._goal = None
            self._log(JournalKind.ERROR, "Локализация потеряна", "Движение остановлено до восстановления позы.")
        elif now - self._localization_lost_since_s > self._settings.localization_recovery_s:
            self._fail("localization_lost", "Поза не восстановилась; движение прекращено.", True)

    # ------------------------------------------------------------ ingestion

    def _ingest(self, observation: Observation) -> None:
        self._simulation_time_s = observation.simulation_time_s
        pose = observation.pose
        self._mission.update_telemetry(
            observation.simulation_time_s, pose, observation.battery_remaining, observation.sample_signal
        )
        penalty = observation.penalty_recent
        for event in self._events.poll() if self._events else ():
            penalty = penalty or event.kind.is_penalty
            if event.kind.is_penalty:
                self._log(
                    JournalKind.OBSERVATION, f"Событие судьи: {event.kind.value}",
                    f"Событие №{event.sequence}; расход рядом не считается чистой стоимостью грунта.",
                    evidence=(f"event-{event.sequence}",),
                )
            self._write(*self._research.record_event(event, pose.point, observation.localization_error_m))
        self._write(*self._research.observe(observation, self._ports.clock.monotonic_s(), penalty))
        if observation.sample_signal is not None and self._research.sensor.quality > 0:
            self._search.record_signal(pose.point, observation.sample_signal)
        for change in self._research.take_changes():
            self._react_to_change(change, observation)
        if self._research.revision != self._published_terrain_revision:
            self._published_terrain_revision = self._research.revision
            self._mission.set_terrain(self._research.terrain_views())
        self._refresh_return_estimate(observation)

    def _react_to_change(self, change, observation: Observation) -> None:
        """Изменение модели прерывает маршрут, который оно затрагивает: план строится заново."""
        goal = self._goal
        path = self._mission.snapshot().planned_path
        affected = goal is not None and (
            (change.bucket is not None and any(self._estimator.bucket_of(p) == change.bucket for p in path))
            or (change.hazard is not None and self._research.hazards.crossings(observation.pose.point, path) > 0)
            or (change.bucket is None and change.hazard is None)
        )
        if not affected:
            self._log(
                JournalKind.DECISION, "Модель обновлена",
                f"{change.cause}; текущий маршрут не затронут, запас возврата пересчитывается.",
                detection_id=change.detection_id,
            )
            return
        self._ports.motion.stop()
        self._goal = None
        self._log(
            JournalKind.DECISION, "Перепланирование",
            f"{change.cause}: прежний маршрут к {goal.kind.value} построен по устаревшей модели и прерван; "
            "следующее решение использует новую оценку.",
            detection_id=change.detection_id,
        )

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
        needed = self._return_estimate_or_conservative(observation.pose.point)
        self._log(
            JournalKind.DECISION, "Возврат по запасу энергии",
            "Проверка запаса имеет приоритет над решением планировщика: "
            f"батарея {observation.battery_remaining:.1f}, оценка возврата {needed:.1f}.",
        )
        if observation.battery_remaining < needed:
            self._log(
                JournalKind.DECISION, "Возврат под угрозой",
                "Консервативная оценка возврата больше остатка батареи. Возвращаемся кратчайшим допустимым "
                "маршрутом; если энергии не хватит, прогон завершится ошибкой, а не успехом.",
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
            self._conclude_experiment(goal.hypothesis_id, observation)

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
        reply = self._reconcile_finish(self._ports.judge.finish())
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

    def _reconcile_finish(self, reply: JudgeReply) -> JudgeReply:
        """Неизвестный исход finish сверяется с публичным счётом; без подтверждения успеха нет."""
        if reply.outcome is not OperationOutcome.UNKNOWN:
            return reply
        score = self._ports.score.score() if self._ports.score else None
        if score is not None and score.finished and score.finish_success is not None:
            self._log(
                JournalKind.DECISION, "Исход finish сверен со счётом",
                f"Ответ судьи не получен; публичный счёт: finish_success={score.finish_success}.",
            )
            return JudgeReply(score.finish_success, "сверено со счётом")
        return JudgeReply(False, f"исход finish неизвестен: {reply.message}", OperationOutcome.UNKNOWN)

    def _reconcile_collect(self, reply: JudgeReply) -> JudgeReply:
        """Неизвестный исход collect: засчитываем только рост публичного счёта, повтор не делаем вслепую."""
        if reply.outcome is not OperationOutcome.UNKNOWN:
            return reply
        score = self._ports.score.score() if self._ports.score else None
        if score is not None and score.collected > self._mission.samples_collected:
            return JudgeReply(True, "сверено со счётом: сбор засчитан")
        return reply

    # ------------------------------------------------------------ decisions

    def _verdict(self, observation: Observation, goal: Subgoal) -> GoalVerdict:
        if goal.kind is GoalKind.COLLECT:
            if not self._research.sensor.usable_for_collect:
                return GoalVerdict(False, "датчик образцов неисправен: сбор вслепую запрещён")
            if self._search.total_collect_attempts >= self._settings.max_collect_attempts:
                return GoalVerdict(False, "исчерпан общий лимит неудачных попыток сбора")
            if self._search.collect_attempts_near(observation.pose.point) >= 2:
                return GoalVerdict(False, "исчерпан лимит попыток сбора в этой области")
        signal = observation.sample_signal
        if signal is not None and self._search.local_signal() is not None:
            signal = self._search.local_signal()  # решение о сборе — по сглаженному сигналу в этой точке
        return validate_subgoal(
            goal, observation.pose.point, observation.battery_remaining, signal,
            self._ports.navigation, self._settings,
        )

    def _build_context(self, observation: Observation) -> PlanningContext:
        pose = observation.pose
        navigation = self._ports.navigation
        settings = self._settings
        valued = self._search.rank_candidates(
            navigation.lattice_points(pose.point), pose.point,
            settings.candidate_min_distance_m, settings.candidate_max_distance_m, limit=10,
            focus_signal=settings.approach_signal_threshold,
        )
        candidates = rank_by_utility(
            valued, pose.point, settings.base, observation.battery_remaining, settings.battery_initial,
            settings.return_reserve, self._energy_along, settings.energy_price,
        )[:6]
        refine: list = []
        best, center = self._search.best_signal or 0.0, self._search.best_point
        if center is not None and best >= settings.approach_signal_threshold:
            if best >= settings.collect_signal_threshold:
                steps = (settings.refine_step_m / 2,)
            elif best >= settings.refine_signal_threshold:
                steps = (settings.refine_step_m, settings.refine_step_m / 2)
            else:
                steps = (2 * settings.refine_step_m, settings.refine_step_m)
            for step in steps:
                refine = self._search.refine_candidates(center, step, navigation.is_reachable)
                if refine:
                    break
        tail = self._ports.journal.tail(self._mission.run_id, 5)
        sensor = self._research.sensor
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
            refine_candidates=tuple(refine),
            at_signal_peak=self._search.at_peak(pose.point),
            local_signal=self._search.local_signal(),
            target_samples=settings.target_samples,
            sensor_state=sensor.state.value,
            sensor_quality=sensor.quality,
            sensor_unusable_s=(
                0.0 if sensor.unusable_since_s is None or observation.simulation_time_s is None
                else observation.simulation_time_s - sensor.unusable_since_s
            ),
            terrain=tuple(
                TerrainView(center, radius, energy, confidence)
                for _, center, radius, energy, confidence in self._estimator.regions()
            ),
            recent_signals=self._search.recent_signals(),
            journal_tail=tuple(f"{entry.draft.title}: {entry.draft.detail}" for entry in tail),
        )

    def _energy_along(self, start: Point, end: Point) -> float:
        """Быстрая консервативная оценка для ранжирования: прямая через оценки грунта с поправкой на обход."""
        factor = self._settings.detour_factor * self._settings.return_safety_factor
        return self._estimator.path_energy(start, [end], factor)

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
        if self._pending_proposal is None:
            self._pending_context = self._build_context(observation)
        context = self._pending_context
        proposed = self._await_proposal(context)
        if proposed is None:
            return  # планировщик ещё думает: тик не блокируется, Stop и контроль наблюдений продолжают работать
        if self._is_cancelled():
            return  # устаревший ответ после Stop игнорируется
        approaching = (context.best_signal or 0) >= self._settings.approach_signal_threshold
        alternatives = [
            Subgoal(GoalKind.APPROACH, candidate.point, "Резервная уточняющая проба после отказа исполнителя.")
            for candidate in context.refine_candidates
        ] + [
            Subgoal(
                GoalKind.APPROACH if approaching else GoalKind.EXPLORE,
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
        if goal.kind is not GoalKind.RETURN and goal.target is not None:
            self._search.note_target(goal.target)
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
        self._research.discard_segment()  # штраф/пауза сбора не относятся к стоимости грунта
        self._mission.set_goal(goal)
        reply = self._reconcile_collect(self._ports.judge.collect())
        position = observation.pose.point
        if reply.outcome is OperationOutcome.UNKNOWN:
            self._search.record_collect_attempt(position)
            self._log(
                JournalKind.OUTCOME, "Исход сбора неизвестен",
                f"Судья не ответил, счёт не подтвердил сбор; попытка учтена как неуспешная. {reply.message}".strip(),
            )
        elif reply.success:
            self._research.note_collect()
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
        navigation = self._ports.navigation
        proposal, notes = self._research.proposal(observation.pose.point, navigation.is_reachable)
        self._write(*notes)
        if proposal is None:
            return False
        verdict = self._verdict(observation, proposal.goal)
        if not verdict.accepted:
            self._write(*self._research.defer(proposal.hypothesis, verdict.reason))
            return False
        self._write(*self._research.start(proposal.hypothesis, verdict.route.energy))
        self._apply_goal(observation, proposal.goal, verdict)
        return True

    def _conclude_experiment(self, hypothesis_id: str, observation: Observation) -> None:
        before = self._return_estimate
        notes = self._research.conclude(hypothesis_id)
        self._write(*notes)
        if not any(note.conclusion for note in notes):
            return
        after = self._ports.navigation.return_energy(observation.pose.point)
        self._return_estimate, self._return_estimate_at = after, observation.pose.point
        self._return_estimate_revision = self._research.revision
        self._mission.set_return_estimate(after)
        hypothesis = self._research.hypotheses.find(hypothesis_id)
        self._log(
            JournalKind.DECISION, "Вывод учтён в решении",
            f"Оценка возврата {_format_energy(before)} → {_format_energy(after)} ед.; следующие маршруты и "
            f"проверка запаса используют обновлённую ячейку {hypothesis.bucket if hypothesis else ''}.",
            hypothesis_id=hypothesis_id,
            detection_id=hypothesis.detection_id if hypothesis else None,
        )


def _format_energy(value: float | None) -> str:
    return "нет оценки" if value is None else f"{value:.1f}"
