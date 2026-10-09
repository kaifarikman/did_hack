"""Контроллер одного прогона: тик за тиком ведёт миссию через порты.

Приоритеты каждого тика: Stop → свежесть наблюдений → батарея → запас на возврат → решение планировщика.
"""
from __future__ import annotations

from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass, replace

from application.event_feed import EventFeed
from application.motion import MotionExecutor, MotionState
from application.navigation_goal import TargetAssessment, assess_navigation_target
from application.plan_execution import NothingValid, PlanExecutor, Waiting
from application.research import TerrainResearch
from application.sample_research import SampleResearch
from application.run_metrics import RunMetrics
from application.team import RobotLink
from application.navigation_service import NavigationService
from application.ports import (
    Clock, EventSource, JournalStore, JudgeClient, JudgeOperation, JudgeReply, MapMode, ObservationSource, OperationOutcome,
    Planner, ResetRequest, ScoreSource, SimulationControl,
)
from application.validation import GoalVerdict, localization_energy_margin, validate_subgoal
from domain.errors import InvalidTransition
from domain.geometry import Point, distance_m
from domain.journal import JournalDraft, JournalKind
from domain.hypotheses import describe_measurement
from domain.mission import HazardView, HypothesisView, Mission, MissionError, MissionStatus, ResearchView
from domain.navigation_task import TaskType
from domain.observations import DEFAULT_ROBOT_ID, LocalizationStatus, Observation
from domain.target_selection import rank_by_utility
from domain.search import SignalSearch
from domain.sample_hypotheses import sample_time
from domain.settings import MissionSettings
from domain.subgoals import GoalKind, PlanningContext, Subgoal, TerrainView

STARTUP_OBSERVATION_GRACE_S = 5.0
LOST_ROBOT_CODES = frozenset({"observations_stale", "observations_incomplete", "localization_lost", "stuck_returning"})
RETURN_ESTIMATE_REFRESH_M = 0.25
NAVIGATION_RETRY_S = 0.5  # пока путь к цели закрыт, A* повторяется не чаще этого интервала
BLOCKED_PROGRESS_M = 0.15  # дальше от места остановки — новый эпизод перекрытия, а не тот же
MEASURED_RATE_MIN_TRAVEL_M = 0.5  # короче — расход на метр слишком шумный для оценки возврата


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
    coordination: RobotLink | None = None  # команда роботов: брони, обмен знаниями, разъезд


@dataclass
class _PendingJudgeOperation:
    action: str
    operation: JudgeOperation
    observation: Observation


@dataclass(frozen=True)
class _BlockedEpisode:
    """Серия остановок перед препятствием на пути к одной цели без продвижения."""

    goal_key: tuple[str, float | None, float | None]
    position: Point
    since_s: float


@dataclass
class _ImmediateJudgeOperation:
    reply: JudgeReply

    def poll(self) -> JudgeReply:
        return self.reply


class MissionController:
    def __init__(
        self,
        mission: Mission,
        ports: ControllerPorts,
        settings: MissionSettings,
        research: TerrainResearch,
        search: SignalSearch,
        planner_executor: Executor | None = None,
        planner_rate_limited: bool = True,
    ) -> None:
        self._mission = mission
        self._ports = ports
        self._settings = settings
        self._research = research
        self._estimator = research.estimator
        self._search = search
        self._sample_research = SampleResearch()
        self._goal: Subgoal | None = None
        self._pending_judge: _PendingJudgeOperation | None = None
        # планировщик (LLM) отвечает в фоне, тик не ждёт его; тесты подставляют синхронный исполнитель
        self._plans = PlanExecutor(
            ports.planner, settings,
            planner_executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="planner"),
            self._log, ports.clock.monotonic_s, self._is_cancelled, planner_rate_limited,
        )
        self._signal_tier = 0
        self._last_replan: tuple[str | None, str | None] = (None, None)
        self._replans = 0
        self._stuck_recovery_attempts: dict[tuple[str, float | None, float | None], int] = {}
        self._decisions = 0
        self._reset_done_at_s: float | None = None
        self._simulation_time_s: float | None = None
        self._return_estimate: float | None = None
        self._return_estimate_at: Point | None = None
        self._return_route_length_m: float | None = None
        self._return_estimate_revision: tuple = ()
        self._published_terrain_revision = -1
        self._localization_lost_since_s: float | None = None
        self._map_missing_since_s: float | None = None
        self._seen_map_revision: int | None = None
        self._seen_dynamic_obstacle_revision = 0
        self._last_pose_point: Point | None = None
        self._yield_since_s: float | None = None
        self._events: EventFeed | None = None
        self._navigation_checked = False
        self._navigation_blocked_since_s: float | None = None
        self._navigation_retry_at_s = 0.0
        self._navigation_misses = 0
        self._navigation_return_logged = False
        self._odometer = _Odometer()
        self._blocked: _BlockedEpisode | None = None
        self._metrics = RunMetrics(settings.return_reserve, settings.pose_jump_m)

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
        if self._pending_judge is not None:
            self._poll_judge_operation()
            return
        if not self._map_ready():
            return
        self._ports.navigation.observe_dynamic_obstacles(
            observation.scan_obstacles, self._ports.clock.monotonic_s(), observation.pose.point)
        if self._check_dynamic_obstacles(observation):
            return
        self._check_map_change(observation)
        if self._yield_to_partner(observation):
            return
        pose = observation.pose
        now_s = self._ports.clock.monotonic_s()
        scan_age_s = (observation.freshness.scan.age_s
                      if observation.freshness is not None else None)
        command_guard = (self._ports.navigation.recovery_command_blocked
                        if self._ports.motion.recovering else self._ports.navigation.command_blocked)
        motion_state = self._ports.motion.step(
            pose, now_s,
            command_blocked=lambda command: command_guard(
                pose, command.linear_mps, command.angular_radps, scan_age_s, now_s),
        )
        if motion_state is MotionState.MOVING:
            self._enforce_reserve(observation)
        elif motion_state is MotionState.ARRIVED:
            self._on_arrival(observation)
        elif motion_state is MotionState.STUCK:
            self._on_stuck(observation)
        elif motion_state is MotionState.BLOCKED:
            self._on_dynamic_obstacle_blocked(observation)
        elif motion_state is MotionState.OFF_PATH:
            self._on_path_deviation(observation)
        elif motion_state is MotionState.RECOVERED:
            self._resume_after_stuck_recovery(observation)
        elif motion_state is MotionState.RECOVERY_FAILED:
            self._on_stuck_recovery_failed(observation)
        elif motion_state is MotionState.RECOVERING:
            return
        else:
            self._decide(observation)

    def _check_dynamic_obstacles(self, observation: Observation) -> bool:
        revision = self._ports.navigation.dynamic_obstacle_revision
        if revision == self._seen_dynamic_obstacle_revision or self._ports.motion.recovering:
            return False  # манёвр восстановления проверяет каждую команду сам и не идёт по пути
        self._seen_dynamic_obstacle_revision = revision
        if self._goal is None:
            return False
        path = self._mission.snapshot().planned_path
        if not self._ports.navigation.path_blocked(observation.pose.point, path):
            return False
        self._on_dynamic_obstacle_blocked(observation)
        return True

    def _on_dynamic_obstacle_blocked(self, observation: Observation) -> None:
        """Стоп перед препятствием. Повтор у той же цели без продвижения не пишется в журнал,
        а дольше `blocked_escalation_s` обрабатывается как застревание: восстановление, затем явный отказ."""
        goal = self._goal
        self._ports.motion.stop()
        now = self._ports.clock.monotonic_s()
        key = self._stuck_recovery_key(goal) if goal is not None else ("none", None, None)
        episode = self._blocked
        if (episode is None or episode.goal_key != key
                or distance_m(observation.pose.point, episode.position) > BLOCKED_PROGRESS_M):
            self._blocked = _BlockedEpisode(key, observation.pose.point, now)
            self._log(
                JournalKind.DECISION, "Остановка перед препятствием",
                f"Свежий scan перекрыл коридор к {goal.kind.value if goal else 'текущей цели'}; команда обнулена, "
                "выбирается обход.",
            )
        elif goal is not None and now - episode.since_s > self._settings.blocked_escalation_s:
            self._blocked = _BlockedEpisode(key, observation.pose.point, now)
            self._log(
                JournalKind.ERROR, "Препятствие не уходит",
                f"Коридор к {goal.kind.value} закрыт дольше {self._settings.blocked_escalation_s:.0f} с без "
                "продвижения; обрабатываем как застревание.",
            )
            self._on_stuck(observation)  # цель сохранена: восстановление, перепланирование или отказ
            return
        self._goal = None
        self._plans.invalidate("свежий scan перекрыл безопасный коридор")
        self._mission.set_goal(None)

    def _repeating_blocked_goal(self, goal: Subgoal) -> bool:
        return self._blocked is not None and self._blocked.goal_key == self._stuck_recovery_key(goal)

    def _on_path_deviation(self, observation: Observation) -> None:
        goal = self._goal
        self._ports.motion.stop()
        if goal is None:
            return
        self._plans.invalidate("устойчивое отклонение от активного маршрута")
        self._last_replan = ("отклонение от маршрута", None)
        self._log(
            JournalKind.DECISION,
            "Перепланирование после отклонения",
            f"Робот устойчиво ушёл от сегмента пути к {goal.kind.value}; движение остановлено, маршрут строится от текущей позы.",
        )
        verdict = self._verdict(observation, goal)
        if verdict.accepted:
            self._start_route(observation, goal, verdict)
        elif goal.kind is GoalKind.RETURN:
            self._fail("no_route_home", f"Возврат невозможен после отклонения от маршрута: {verdict.reason}")
        else:
            self._goal = None
            self._mission.set_goal(None)

    # ------------------------------------------------------------ команда

    def _coordinate(self, observation: Observation) -> None:
        link = self._ports.coordination
        if link is None:
            return
        now = self._ports.clock.monotonic_s()
        link.report_pose(observation.pose, now)
        if observation.sample_signal is not None and self._research.sensor.quality > 0:
            link.share_signal(observation.pose.point, observation.sample_signal, observation.simulation_time_s)
        for shared in link.partner_signals():
            self._search.record_shared(shared.point, shared.signal)
        for point in link.partner_collects():
            self._search.forget_near(point)
            self._plans.invalidate("партнёр собрал образец: сигнал рядом относится к другому образцу")
            self._log(JournalKind.OBSERVATION, "Партнёр собрал образец",
                      f"Сбор партнёра у ({point.x_m:.2f}, {point.y_m:.2f}): история сигнала рядом забыта.")
        for robot_id in link.newly_lost(now):
            self._log(JournalKind.DECISION, "Партнёр потерян",
                      f"Нет наблюдений {robot_id}: его брони освобождены, продолжаем со своим запасом энергии.")

    def _yield_to_partner(self, observation: Observation) -> bool:
        """Ближе безопасного расстояния уступает робот с меньшим приоритетом; ожидание ограничено."""
        link = self._ports.coordination
        if link is None or self._goal is None:
            self._yield_since_s = None
            return False
        now = self._ports.clock.monotonic_s()
        partner = link.must_yield(observation.pose.point, now)
        if partner is None:
            self._yield_since_s = None
            return False
        if self._yield_since_s is None:
            self._yield_since_s = now
            self._log(JournalKind.DECISION, "Уступаем дорогу", f"{partner} ближе безопасного расстояния: пауза без отмены пути.")
        if now - self._yield_since_s > self._settings.yield_max_s:
            self._yield_since_s = None
            self._ports.motion.stop()
            link.release()
            self._plans.step_finished(False)
            self._goal = None
            self._log(JournalKind.DECISION, "Взаимная блокировка",
                      f"Ожидание {partner} дольше {self._settings.yield_max_s:.0f} с: цель отдана, выбираем другую.")
            return True
        self._ports.motion.hold()
        return True

    # ------------------------------------------------------------ карта

    def _map_ready(self) -> bool:
        """SLAM: карты может ещё не быть. Стоим, ждём ограниченное время, затем честный отказ."""
        if self._ports.navigation.map_available:
            self._map_missing_since_s = None
            return True
        self._ports.motion.stop()
        now = self._ports.clock.monotonic_s()
        if self._map_missing_since_s is None:
            self._map_missing_since_s = now
            self._log(JournalKind.OBSERVATION, "Ожидание карты", "Карты ещё нет: движение не начинается, пока нет известных свободных клеток.")
        elif now - self._map_missing_since_s > self._settings.map_wait_s:
            self._fail("map_unavailable", "Карта не появилась; без неё маршрут и возврат не проверяются.", True)
        return False

    def _check_map_change(self, observation: Observation) -> None:
        """Новая версия карты: маршрут через ставшие запретными клетки прерывается."""
        revision = self._ports.navigation.map_revision
        if revision == self._seen_map_revision:
            return
        first = self._seen_map_revision is None
        self._seen_map_revision = revision
        self._mission.set_map_id(self._ports.navigation.map_id, self._ports.navigation.map_revision)
        if first or self._goal is None:
            return
        path = self._mission.snapshot().planned_path
        if not self._ports.navigation.path_blocked(observation.pose.point, path):
            return
        self._ports.motion.stop()
        goal, self._goal = self._goal, None
        self._plans.invalidate(f"карта обновлена (версия {revision}): маршрут пересекает препятствие или неизвестное")
        self._last_replan = ("обновление карты", None)
        self._log(JournalKind.DECISION, "Перепланирование",
                  f"Карта версии {revision}: маршрут к {goal.kind.value} больше недопустим и прерван.")

    def _check_pose_jump(self, observation: Observation) -> None:
        """Скачок позы без соответствующего движения — коррекция локализации, не путь по грунту."""
        previous, self._last_pose_point = self._last_pose_point, observation.pose.point
        if previous is None:
            return
        jump = distance_m(previous, observation.pose.point)
        if jump < self._settings.pose_jump_m:
            return
        self._interrupt_sample("скачок локализации")
        delta = Point(observation.pose.x_m - previous.x_m, observation.pose.y_m - previous.y_m)
        self._research.discard_segment()
        self._search.shift_since_correction(delta)
        self._log(
            JournalKind.OBSERVATION, "Коррекция позы",
            f"Поза сместилась на {jump:.2f} м за один тик. Текущее измерение расхода отброшено; "
            "измерения сигнала с прошлой коррекции сдвинуты на ту же величину.",
        )

    # ------------------------------------------------------------ lifecycle

    def _log(self, kind: JournalKind, title: str, detail: str, **fields) -> None:
        self._write(JournalDraft(kind, title, detail, self._simulation_time_s, **fields))

    def _write(self, *drafts: JournalDraft) -> None:
        team = self._ports.coordination is not None
        for draft in drafts:
            if team and draft.robot_id is None:
                draft = replace(draft, robot_id=self._ports.robot_id)
            self._ports.journal.append(self._mission.run_id, draft)

    def _reset_and_start(self) -> None:
        self._ports.motion.stop()
        link = self._ports.coordination
        request = ResetRequest(
            self._mission.scenario, self._mission.seed, self._mission.generation,
            self._ports.map_mode, link.team_ids if link else (self._ports.robot_id,),
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
        self._interrupt_sample("миссия остановлена")
        self._plans.cancel()
        self._pending_judge = None
        self._ports.motion.stop()
        self._goal = None
        try:
            self._mission.confirm_stopped()
        except InvalidTransition:
            return
        self._mission.set_goal(None)
        self._leave_team()
        self._log(JournalKind.DECISION, "Миссия остановлена", "Stop прервал исполнение; это не успешное завершение.")

    def _leave_team(self, lost: bool = False) -> None:
        link = self._ports.coordination
        if link is None:
            return
        if lost:
            link.mark_lost()  # партнёр узнает о потере и не будет ждать этого робота
        else:
            link.finish()

    def abort(self, message: str) -> None:
        self._fail("internal_error", message)

    def _fail(self, code: str, message: str, retryable: bool = False) -> None:
        self._interrupt_sample(code)
        self._ports.motion.stop()
        self._pending_judge = None
        self._mission.fail(MissionError(code, message, retryable))
        self._mission.set_goal(None)
        self._leave_team(lost=code in LOST_ROBOT_CODES)
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
        if observation.freshness is not None:
            self._mission.set_freshness(observation.freshness)
            sources = (observation.freshness.odom, observation.freshness.scan,
                       observation.freshness.battery, observation.freshness.clock)
            if any(source.fresh is False for source in sources):
                self._fail("observations_stale", "Критический источник наблюдений устарел; движение остановлено.", True)
                return None
            if any(source.fresh is None for source in sources):
                self._ports.motion.stop()
                if clock.monotonic_s() - started > STARTUP_OBSERVATION_GRACE_S:
                    self._fail("observations_stale", "Не получен полный набор критических наблюдений.", True)
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

    def _lose_localization(self) -> None:
        """Потеря позы — критический отказ движения: стоим и ждём восстановления ограниченное время."""
        now = self._ports.clock.monotonic_s()
        if self._localization_lost_since_s is None:
            self._localization_lost_since_s = now
            self._interrupt_sample("локализация потеряна")
            self._goal = None
            self._log(JournalKind.ERROR, "Локализация потеряна", "Движение остановлено до восстановления позы.")
        elif now - self._localization_lost_since_s > self._settings.localization_recovery_s:
            self._fail("localization_lost", "Поза не восстановилась; движение прекращено.", True)

    # ------------------------------------------------------------ ingestion

    def _ingest(self, observation: Observation) -> None:
        self._simulation_time_s = observation.simulation_time_s
        if self._sample_research.active is not None and (self._goal is None or
                self._goal.hypothesis_id != self._sample_research.active.hypothesis_id):
            self._interrupt_sample("проверочная подцель прервана")
        self._check_pose_jump(observation)
        pose = observation.pose
        self._mission.update_telemetry(
            observation.simulation_time_s, pose, observation.battery_remaining, observation.sample_signal,
            observation.sequence, observation.sample_signal_age_s,
            observation.freshness,
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
        self._sample_research.observe(observation, self._research.sensor.quality >= 0.8, self._ports.clock.monotonic_s())
        if observation.sample_signal is not None and self._research.sensor.quality > 0:
            self._search.record_signal(pose.point, observation.sample_signal)
        for change in self._research.take_changes():
            self._react_to_change(change, observation)
        self._coordinate(observation)
        self._publish_research()
        if self._research.revision != self._published_terrain_revision:
            self._published_terrain_revision = self._research.revision
            self._mission.set_terrain(self._research.terrain_views())
        if self._is_navigation:
            self._odometer.record(pose.point, observation.battery_remaining, self._settings.pose_jump_m)
        self._refresh_return_estimate(observation)
        self._mission.set_analytics(self._metrics.observe(
            replace(self._mission.snapshot(), return_energy_estimate=(
                None if self._return_estimate is None else self._return_estimate * self._localization_margin(observation))),
            self._ports.clock.monotonic_s(), self._plans.waiting, self._plans.metrics))

    def _publish_research(self) -> None:
        research, sensor = self._research, self._research.sensor
        self._mission.set_research(ResearchView(
            sensor_state=sensor.state.value,
            sensor_fault=sensor.fault.value if sensor.fault else None,
            sensor_quality=sensor.quality,
            hazards=tuple(HazardView(h.detection_id, h.center, h.radius_m, h.hits) for h in research.hazards.sightings),
            hypotheses=tuple(
                HypothesisView(item.hypothesis_id, item.kind.value, item.status.value, item.center,
                               item.prediction.describe(), None if item.status.value == "testing" else describe_measurement(item), item.detection_id,
                               item.experiment_id, item.expected_energy_per_m,
                               None if item.status.value == "testing" else item.measured_energy_per_m,
                               0.0 if item.status.value == "testing" else item.measured_distance_m,
                               item.prediction.confirm_at_least, item.prediction.confirm_at_most)
                for item in research.hypotheses.items
            ) + self._sample_research.views(),
            last_replan_reason=self._last_replan[0],
            last_replan_detection_id=self._last_replan[1],
            planner_requests=self._plans.requests,
            active_hypothesis_id=(self._sample_research.active.hypothesis_id if self._sample_research.active is not None else
                                  self._goal.hypothesis_id if self._goal is not None
                                  and self._goal.hypothesis_id is not None
                                  and any(item.hypothesis_id == self._goal.hypothesis_id and item.status.value == "testing"
                                          for item in research.hypotheses.items) else None),
        ))

    def _react_to_change(self, change, observation: Observation) -> None:
        """Изменение модели прерывает маршрут, который оно затрагивает: план строится заново."""
        goal = self._goal
        path = self._mission.snapshot().planned_path
        affected = goal is not None and (
            (change.bucket is not None and any(self._estimator.bucket_of(p) == change.bucket for p in path))
            or (change.hazard is not None and self._research.hazards.crossings(observation.pose.point, path) > 0)
            or (change.bucket is None and change.hazard is None and not self._is_navigation)
        )
        if not affected:
            self._plans.invalidate(change.cause, change.detection_id)
            self._log(
                JournalKind.DECISION, "Модель обновлена",
                f"{change.cause}; текущий маршрут не затронут, запас возврата пересчитывается.",
                detection_id=change.detection_id,
            )
            return
        self._ports.motion.stop()
        self._goal = None
        self._plans.invalidate(change.cause, change.detection_id)
        self._last_replan = (change.cause, change.detection_id)
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
            or self._model_key() != self._return_estimate_revision
        )
        if not moved:
            return
        route = self._ports.navigation.return_route(position)
        self._return_estimate = route.energy if route else None
        self._return_route_length_m = route.length_m if route else None
        self._return_estimate_at = position
        self._return_estimate_revision = self._model_key()
        self._mission.set_return_estimate(self._return_estimate)

    def _model_key(self) -> tuple:
        """Версия всего, от чего зависит оценка возврата: модель среды и карта."""
        return self._research.revision, self._ports.navigation.map_revision

    def _return_estimate_or_conservative(self, position: Point) -> float:
        """Неизвестная оценка не равна нулю: берём прямое расстояние с запасом и prior."""
        if self._return_estimate is not None:
            return max(self._return_estimate, self._measured_return_energy())
        straight = distance_m(position, self._settings.base) * 1.5
        return max(straight * self._estimator.prior_energy_per_m * self._settings.return_safety_factor,
                   self._measured_return_energy())

    def _measured_return_energy(self) -> float:
        """Навигация: возврат не дешевле фактического расхода на метр в этом прогоне.

        Оценка грунта при низкой уверенности тянется к prior и занижает дорогой путь; измеренный
        расход включает повороты и штрафы, поэтому как нижняя граница консервативен.
        """
        rate = self._odometer.energy_per_m(MEASURED_RATE_MIN_TRAVEL_M)
        if not self._is_navigation or rate is None or self._return_route_length_m is None:
            return 0.0
        return rate * self._return_route_length_m * self._settings.return_safety_factor

    def _reserve_low(self, observation: Observation) -> bool:
        needed = self._return_estimate_or_conservative(observation.pose.point) * self._localization_margin(observation)
        return observation.battery_remaining < needed + self._settings.return_reserve

    def _localization_margin(self, observation: Observation) -> float:
        """Неточная поза удлиняет фактический путь домой: запас растёт с оценкой ошибки."""
        return localization_energy_margin(observation.localization_error_m, observation.localization)

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
        self._note_navigation_return(observation, "запас энергии на возврат на пределе")

    def _on_arrival(self, observation: Observation) -> None:
        goal, self._goal = self._goal, None
        self._replans = 0
        self._blocked = None
        if goal is None:
            return
        if self._is_navigation and goal.kind is not GoalKind.RETURN:
            self._on_navigation_arrival(observation)
            return
        if self._ports.coordination is not None and goal.kind is not GoalKind.RETURN:
            self._ports.coordination.release()
        self._plans.step_finished(True)
        self._publish_plan()
        if goal.kind is GoalKind.RETURN:
            self._finish_mission(observation)
        elif self._sample_research.active is not None and goal.hypothesis_id == self._sample_research.active.hypothesis_id:
            self._finish_sample(observation)
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
            if self._is_navigation:
                self._return_without_target(observation, "нет прогресса к цели после перепланирований")
                return
            self._plans.step_finished(False)
            self._publish_plan()
            self._goal = None
            self._replans = 0
            return
        recovery_key = self._stuck_recovery_key(goal)
        attempts = self._stuck_recovery_attempts.get(recovery_key, 0)
        if attempts < self._settings.max_stuck_recovery_attempts_per_goal:
            return_budget = (self._return_estimate_or_conservative(observation.pose.point)
                             * self._localization_margin(observation))
            recovery_budget = self._settings.return_reserve + self._settings.stuck_recovery_energy_budget
            if observation.battery_remaining - return_budget < recovery_budget:
                self._log(JournalKind.DECISION, "Восстановление отменено по энергии",
                          f"Для безопасного манёвра нужно оставить ≈{recovery_budget:.1f} ед. сверх возврата.")
                if goal.kind is GoalKind.RETURN:
                    self._fail("stuck_returning", "Не хватает энергии на безопасное восстановление и возврат.")
                elif self._is_navigation:
                    self._return_without_target(observation, "нет энергии на манёвр восстановления")
                else:
                    self._plans.step_finished(False)
                    self._publish_plan()
                    self._goal = None
                    self._mission.set_goal(None)
                return
            self._stuck_recovery_attempts[recovery_key] = attempts + 1
            self._ports.motion.begin_recovery(
                observation.pose, self._ports.clock.monotonic_s(),
                reverse_m=self._settings.stuck_recovery_reverse_m,
                turn_rad=self._settings.stuck_recovery_turn_rad,
                reverse_speed_mps=self._settings.stuck_recovery_reverse_speed_mps,
                turn_speed_radps=self._settings.stuck_recovery_turn_speed_radps,
                timeout_s=self._settings.stuck_recovery_timeout_s,
            )
            self._log(JournalKind.DECISION, "Безопасное восстановление",
                      f"Попытка {attempts + 1}: короткий отход и проверка поворота; лимит "
                      f"{self._settings.stuck_recovery_timeout_s:.1f} с.")
            return
        self._replan_after_stuck(observation, goal)

    @staticmethod
    def _stuck_recovery_key(goal: Subgoal) -> tuple[str, float | None, float | None]:
        target = goal.target
        return (goal.kind.value,
                round(target.x_m, 3) if target else None,
                round(target.y_m, 3) if target else None)

    def _resume_after_stuck_recovery(self, observation: Observation) -> None:
        goal = self._goal
        if goal is None:
            return
        self._log(JournalKind.DECISION, "Восстановление завершено",
                  "Отход и проверенный поворот выполнены; повторно проверяем маршрут к сохранённой цели.")
        verdict = self._verdict(observation, goal)
        if verdict.accepted:
            self._start_route(observation, goal, verdict)
        elif goal.kind is GoalKind.RETURN:
            self._fail("no_route_home", f"Маршрут на базу не найден после восстановления: {verdict.reason}")
        else:
            self._goal = None
            self._mission.set_goal(None)

    def _on_stuck_recovery_failed(self, observation: Observation) -> None:
        self._log(JournalKind.ERROR, "Манёвр восстановления прерван",
                  "Отход/поворот заблокирован scan-проверкой или вышел за временной лимит; пробуем только новый маршрут.")
        if self._goal is not None:
            self._replan_after_stuck(observation, self._goal)

    def _replan_after_stuck(self, observation: Observation, goal: Subgoal) -> None:
        verdict = self._verdict(observation, goal)
        if verdict.accepted:
            self._start_route(observation, goal, verdict)
        elif goal.kind is GoalKind.RETURN:
            self._fail("no_route_home", "Маршрут на базу не найден.")
        else:
            self._goal = None
            self._mission.set_goal(None)

    def _finish_mission(self, observation: Observation) -> None:
        self._pending_judge = _PendingJudgeOperation(
            "finish", self._begin_judge_operation("finish"), observation,
        )
        self._poll_judge_operation()

    def _poll_judge_operation(self) -> None:
        pending = self._pending_judge
        if pending is None:
            return
        reply = pending.operation.poll()
        if reply is None:
            return
        self._pending_judge = None
        if pending.action == "collect":
            self._complete_collect(pending.observation, reply)
        else:
            self._complete_finish(pending.observation, reply)

    def _begin_judge_operation(self, action: str) -> JudgeOperation:
        begin = getattr(self._ports.judge, f"begin_{action}", None)
        if callable(begin):
            return begin()
        # Совместимость со старыми адаптерами в fake-world и переходных версиях.
        reply = getattr(self._ports.judge, action)()
        return _ImmediateJudgeOperation(reply)

    def _complete_finish(self, observation: Observation, reply: JudgeReply) -> None:
        reply = self._reconcile_finish(reply)
        mission = self._mission
        if self._is_navigation:
            self._complete_navigation_finish(observation, reply)
            return
        solo = self._ports.coordination is None
        if solo and mission.samples_collected == 0:
            self._fail("no_confirmed_sample", "Возврат без подтверждённого образца; успех не засчитан.")
            return
        try:
            # в команде возврат без своего сбора допустим: общий успех требует сбора хотя бы одним роботом
            mission.complete(reply.success, require_sample=solo)
        except InvalidTransition as error:
            self._fail("finish_rejected", f"Завершение не принято: {error}. {reply.message}".strip())
            return
        mission.set_goal(None)
        self._leave_team()
        self._log(
            JournalKind.OUTCOME, "Миссия завершена",
            f"Судья подтвердил возврат; образцов: {mission.samples_collected}, "
            f"батарея {observation.battery_remaining:.1f}.",
        )

    def _reconcile_finish(self, reply: JudgeReply) -> JudgeReply:
        """Неизвестный исход finish сверяется с публичным счётом; без подтверждения успеха нет."""
        if reply.outcome is not OperationOutcome.UNKNOWN:
            return reply
        score = self._current_score()
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
        score = self._current_score()
        if score is not None and score.collected > self._mission.samples_collected:
            return JudgeReply(True, "сверено со счётом: сбор засчитан")
        return reply

    def _current_score(self):
        score = self._ports.score.score() if self._ports.score else None
        if score is not None and score.generation is not None and score.generation != self._mission.generation:
            return None
        return score

    # ------------------------------------------------------------ decisions

    def _verdict(self, observation: Observation, goal: Subgoal) -> GoalVerdict:
        if goal.kind is GoalKind.COLLECT:
            if not self._research.sensor.usable_for_collect:
                return GoalVerdict(False, "датчик образцов неисправен: сбор вслепую запрещён")
            if self._search.total_collect_attempts >= self._settings.max_collect_attempts:
                return GoalVerdict(False, "исчерпан общий лимит неудачных попыток сбора")
            if self._search.collect_attempts_near(observation.pose.point) >= 2:
                return GoalVerdict(False, "исчерпан лимит попыток сбора в этой области")
        link = self._ports.coordination
        if link is not None and goal.kind in (GoalKind.EXPLORE, GoalKind.APPROACH) and goal.target is not None:
            holder = link.conflict(goal.target, self._ports.clock.monotonic_s())
            if holder is not None:
                return GoalVerdict(False, f"область цели забронирована {holder}")
        signal = observation.sample_signal
        if signal is not None and self._search.local_signal() is not None:
            signal = self._search.local_signal()  # решение о сборе — по сглаженному сигналу в этой точке
        return validate_subgoal(
            goal, observation.pose.point, observation.battery_remaining, signal,
            self._ports.navigation, self._settings,
            observation.localization_error_m, observation.localization,
        )

    def _build_context(self, observation: Observation, plan_id: str = "plan-0", epoch: int = 0) -> PlanningContext:
        pose = observation.pose
        navigation = self._ports.navigation
        settings = self._settings
        valued = self._search.rank_candidates(
            navigation.lattice_points(pose.point), pose.point,
            settings.candidate_min_distance_m, settings.candidate_max_distance_m, limit=10,
            focus_signal=settings.approach_signal_threshold,
            frontier=navigation.frontier_points(pose.point) if self._ports.map_mode is MapMode.SLAM else (),
        )
        candidates = rank_by_utility(
            valued, pose.point, settings.base, observation.battery_remaining, settings.battery_initial,
            settings.return_reserve, self._energy_along, settings.energy_price,
            action_energy=settings.false_collect_energy_penalty,
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
            metrics=None if self._metrics.view is None else self._metrics.view.summary,
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
            journal_tail=tuple(f"#{entry.sequence} {entry.draft.title}: {entry.draft.detail}" for entry in tail),
            mission_text=self._mission.mission_text,
            plan_id=plan_id,
            model_epoch=epoch,
            map_revision=self._ports.navigation.map_revision,
            max_plan_steps=settings.max_plan_steps,
            hypotheses=tuple(
                f"{item.hypothesis_id} [{item.status.value}] {item.kind.value} ячейка {item.bucket}: "
                f"{item.prediction.describe()}"
                for item in self._research.hypotheses.items[-4:]
            ) + tuple(f"{item.hypothesis_id} [{item.status}] {item.prediction} {item.conclusion or ''}"
                      for item in self._sample_research.items[-4:]),
            detections=tuple(
                f"{entry.draft.detection_id}: {entry.draft.title}"
                for entry in tail if entry.draft.detection_id
            ),
            hazards=tuple((h.center, h.radius_m) for h in self._research.hazards.sightings),
        )

    def _energy_along(self, start: Point, end: Point) -> float:
        """Быстрая консервативная оценка для ранжирования: прямая через оценки грунта с поправкой на обход."""
        factor = self._settings.detour_factor * self._settings.return_safety_factor
        return self._estimator.path_energy(start, [end], factor)

    def _decide(self, observation: Observation) -> None:
        mission = self._mission
        if self._is_navigation and mission.status is not MissionStatus.RETURNING:
            self._decide_navigation(observation)
            return
        if mission.status.value == "returning":
            self._decisions += 1
            self._search.note_decision()
            self._apply_goal(
                observation, Subgoal(GoalKind.RETURN, self._settings.base, "Продолжаем возврат на базу.")
            )
            return
        if self._reserve_low(observation):
            self._plans.cancel()
            self._enforce_reserve(observation)
            return
        if not self._plans.waiting:
            self._decisions += 1
            self._search.note_decision()
            self._note_signal_tier()
            if self._try_experiment(observation):
                return
        decision = self._plans.poll(
            lambda plan_id, epoch: self._build_context(observation, plan_id, epoch),
            lambda goal: self._verdict(observation, goal),
        )
        self._publish_plan()
        if isinstance(decision, Waiting):
            return  # планировщик ещё думает: тик не блокируется, Stop и контроль наблюдений продолжают работать
        if isinstance(decision, NothingValid):
            self._fail("no_valid_goal", "Ни одна подцель, включая возврат, не допустима.")
            return
        self._apply_goal(observation, decision.goal, decision.verdict)
        self._publish_plan()

    def _note_signal_tier(self) -> None:
        """Сигнал перешёл в более сильный режим поиска: план, построенный для разведки, пересматривается."""
        best = self._search.best_signal or 0.0
        settings = self._settings
        tier = 2 if best >= settings.refine_signal_threshold else 1 if best >= settings.approach_signal_threshold else 0
        if tier > self._signal_tier:
            self._plans.invalidate(f"лучший сигнал вырос до {best:.2f}")
        self._signal_tier = tier

    def _publish_plan(self) -> None:
        progress = self._plans.progress
        if progress is not None:
            self._mission.set_plan(progress.plan, tuple(progress.statuses), progress.revision_reason)

    def _is_cancelled(self) -> bool:
        return self._mission.stop_requested or self._mission.status.is_terminal

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
        active = self._sample_research.active
        if active is not None and goal.hypothesis_id != active.hypothesis_id:
            self._interrupt_sample("принята другая подцель")
        if not self._is_navigation and goal.target is not None:
            hypothesis, notes = self._sample_research.start(
                observation, goal, self._search.predicted_signal(goal.target), self._research.sensor.quality >= 0.8, self._ports.clock.monotonic_s())
            self._write(*notes)
            if hypothesis is not None:
                goal = replace(goal, hypothesis_id=hypothesis.hypothesis_id)
        if goal.kind is GoalKind.RETURN:
            mission.begin_return()
        self._goal = goal
        if goal.kind is not GoalKind.RETURN and goal.target is not None:
            self._search.note_target(goal.target)
        link = self._ports.coordination
        if link is not None:
            if goal.kind is GoalKind.RETURN:
                link.release()
            elif goal.target is not None:
                link.claim(goal.target, self._ports.clock.monotonic_s())
        mission.set_goal(goal, verdict.route.waypoints)
        self._publish_research()
        self._ports.motion.follow(list(verdict.route.waypoints), start=observation.pose.point)
        if self._repeating_blocked_goal(goal):
            return  # тот же маршрут после остановки перед препятствием: уже записан
        self._log(
            JournalKind.DECISION, f"Подцель: {goal.kind.value}",
            f"{goal.reason} Источник: {goal.source}. Расход по маршруту ≈ {verdict.route.energy:.1f}, "
            f"оценка возврата {self._return_estimate_or_conservative(observation.pose.point):.1f} "
            f"(по {len(self._estimator.measured_buckets())} измеренным участкам), батарея "
            f"{observation.battery_remaining:.2f}.",
            hypothesis_id=goal.hypothesis_id, plan_id=goal.plan_id,
        )

    def _collect(self, observation: Observation, goal: Subgoal) -> None:
        self._ports.motion.stop()
        self._research.discard_segment()  # штраф/пауза сбора не относятся к стоимости грунта
        self._mission.set_goal(goal)
        self._pending_judge = _PendingJudgeOperation(
            "collect", self._begin_judge_operation("collect"), observation,
        )
        self._poll_judge_operation()

    def _complete_collect(self, observation: Observation, reply: JudgeReply) -> None:
        reply = self._reconcile_collect(reply)
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
            if self._ports.coordination is not None:
                self._ports.coordination.share_collect(position, observation.simulation_time_s)
            self._plans.invalidate("образец собран: сигнал теперь относится к другому образцу")
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

    # ----------------------------------------------------------- navigation

    @property
    def _is_navigation(self) -> bool:
        return self._mission.task_type is TaskType.NAVIGATION

    def _decide_navigation(self, observation: Observation) -> None:
        """Обязательная цель пользователя без LLM и поиска; запас и возврат имеют приоритет."""
        task = self._mission.navigation
        now = self._ports.clock.monotonic_s()
        if now < self._navigation_retry_at_s:
            return
        if not self._navigation_checked and task.target.map_id != self._ports.navigation.map_id:
            self._fail("map_changed", "Карта после сброса отличается от карты, по которой выбрана цель; "
                                      "движение не начато.")
            return
        if task.is_reached_by(observation.pose.point):
            self._confirm_navigation_target(observation)
            self._on_target_reached(observation)
            return
        if self._navigation_checked and self._reserve_low(observation):
            self._enforce_reserve(observation)
            return
        assessment = assess_navigation_target(
            self._ports.navigation, self._settings, observation.pose.point, task.target.point,
            observation.battery_remaining, self._localization_margin(observation),
        )
        if not assessment.accepted:
            self._on_navigation_refused(observation, assessment, now)
            return
        self._navigation_blocked_since_s = None
        goal = Subgoal(GoalKind.EXPLORE, task.target.point, "Пользовательская цель навигации.")
        self._start_route(observation, goal, GoalVerdict(True, route=assessment.route))
        self._confirm_navigation_target(observation)

    def _confirm_navigation_target(self, observation: Observation) -> None:
        """Проверка после сброса пройдена: цель принята один раз за прогон."""
        if self._navigation_checked:
            return
        self._navigation_checked = True
        self._navigation_event(
            JournalKind.DECISION, "navigation_target_set", observation,
            "Цель проверена после сброса по свежей позе, карте и батарее; движение начато.",
        )

    def _on_navigation_refused(self, observation: Observation, assessment: TargetAssessment, now_s: float) -> None:
        if assessment.problem.transient:
            self._ports.motion.stop()
            self._navigation_retry_at_s = now_s + NAVIGATION_RETRY_S
            if self._navigation_blocked_since_s is None:
                self._navigation_blocked_since_s = now_s
                self._log(JournalKind.DECISION, "Путь к цели закрыт",
                          f"{assessment.message} Ожидаем до {self._settings.navigation_blocked_wait_s:.0f} с; "
                          "робот стоит.")
                return
            if now_s - self._navigation_blocked_since_s <= self._settings.navigation_blocked_wait_s:
                return
        if not self._navigation_checked:
            self._fail("navigation_target_unreachable",
                       f"Проверка цели после сброса: {assessment.message} Движение не начато.")
            return
        self._return_without_target(observation, assessment.message.rstrip("."))

    def _on_navigation_arrival(self, observation: Observation) -> None:
        """Путь пройден; достижение подтверждает только наблюдаемая поза в пределах допуска."""
        task = self._mission.navigation
        if task.is_reached_by(observation.pose.point):
            self._navigation_misses = 0
            self._on_target_reached(observation)
            return
        self._navigation_misses += 1
        miss_m = distance_m(observation.pose.point, task.target.point)
        self._log(JournalKind.DECISION, "Цель не подтверждена позой",
                  f"Путь пройден, но поза в {miss_m:.2f} м от цели при допуске {task.arrival_tolerance_m:.2f} м; "
                  f"попытка {self._navigation_misses}.")
        if self._navigation_misses > self._settings.max_replans:
            self._return_without_target(observation, "поза не подтвердила достижение цели")

    def _on_target_reached(self, observation: Observation) -> None:
        self._ports.motion.stop()
        self._goal = None
        if self._mission.mark_target_reached(observation.simulation_time_s):
            self._navigation_event(
                JournalKind.OUTCOME, "navigation_target_reached", observation,
                "Цель достигнута по наблюдаемой позе. Это не завершение миссии: начинается возврат.",
            )
        self._start_navigation_return(observation, "цель достигнута")

    def _return_without_target(self, observation: Observation, reason: str) -> None:
        self._ports.motion.stop()
        self._goal = None
        self._mission.set_goal(None)
        self._log(JournalKind.DECISION, "Возврат без достижения цели",
                  f"{reason}. Безопасный возврат имеет приоритет; без достижения цели итог не будет completed.")
        self._start_navigation_return(observation, reason)

    def _start_navigation_return(self, observation: Observation, reason: str) -> None:
        self._apply_goal(observation, Subgoal(GoalKind.RETURN, self._settings.base, f"Возврат на базу: {reason}."))
        self._note_navigation_return(observation, reason)

    def _note_navigation_return(self, observation: Observation, reason: str) -> None:
        if (not self._is_navigation or self._navigation_return_logged
                or self._mission.status is not MissionStatus.RETURNING):
            return
        self._navigation_return_logged = True
        reached = self._mission.navigation.target_reached
        self._navigation_event(
            JournalKind.DECISION, "navigation_return_started", observation,
            f"Причина возврата: {reason}. Цель {'достигнута' if reached else 'не достигнута'}.",
        )

    def _navigation_event(self, kind: JournalKind, name: str, observation: Observation, text: str) -> None:
        snapshot = self._mission.snapshot()
        target, pose = snapshot.navigation.target, observation.pose
        time_text = "нет" if observation.simulation_time_s is None else f"{observation.simulation_time_s:.2f} с"
        self._log(
            kind, name,
            f"{text} Прогон {snapshot.run_id}, поколение {snapshot.generation}; поза ({pose.x_m:.2f}, "
            f"{pose.y_m:.2f}, {pose.heading_rad:.2f} рад); цель ({target.point.x_m:.2f}, {target.point.y_m:.2f}) "
            f"на карте {target.map_id}; ревизия пути {snapshot.route_revision}; время симуляции {time_text}.",
            evidence=(f"run:{snapshot.run_id}", f"generation:{snapshot.generation}",
                      f"route_revision:{snapshot.route_revision}"),
        )

    def _complete_navigation_finish(self, observation: Observation, reply: JudgeReply) -> None:
        mission = self._mission
        task = mission.navigation
        if not task.target_reached:
            verdict = "подтвердил возврат" if reply.success else f"не подтвердил возврат ({reply.message})"
            self._fail("navigation_goal_not_reached",
                       f"Робот вернулся на базу без достижения цели; судья {verdict}.")
            return
        try:
            mission.complete(reply.success, require_sample=False)
        except InvalidTransition as error:
            self._fail("finish_rejected", f"Завершение не принято: {error}. {reply.message}".strip())
            return
        mission.set_goal(None)
        reached_at = "" if task.target_reached_at_s is None else f" в {task.target_reached_at_s:.1f} с"
        self._log(
            JournalKind.OUTCOME, "Миссия завершена",
            f"Цель достигнута{reached_at}, возврат подтверждён судьёй; батарея {observation.battery_remaining:.1f}.",
        )

    # ----------------------------------------------------------- experiment

    def _interrupt_sample(self, reason: str) -> None:
        _, notes = self._sample_research.finish(self._simulation_time_s, reason)
        self._write(*notes)
        if notes:
            self._publish_research()

    def _finish_sample(self, observation: Observation) -> None:
        reason = None if self._research.sensor.quality >= 0.8 and sample_time(observation, self._ports.clock.monotonic_s()) is not None else "датчик недостоверен или устарел"
        item, notes = self._sample_research.finish(observation.simulation_time_s, reason)
        self._write(*notes)
        if item is not None and item.status in ("confirmed", "refuted"):
            self._search.assimilate_measurement(item.center, item.measured_signal)
            self._plans.invalidate(f"проверен прогноз {item.hypothesis_id}")
            self._publish_plan()
            self._log(JournalKind.DECISION, "Вывод учтён в решении",
                      "Старые оценки сигнала в радиусе 0.30 м заменены независимой медианой; "
                      "оставшиеся шаги плана сброшены. Следующий выбор цели использует уточнённый прогноз сигнала.",
                      hypothesis_id=item.hypothesis_id, experiment_id=item.experiment_id,
                      observed=item.measurement)
        self._publish_research()

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
        self._plans.invalidate(f"начата проверка {proposal.hypothesis.hypothesis_id}")
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
        self._return_estimate_revision = self._model_key()
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


class _Odometer:
    """Пройденный путь и потраченная энергия с начала прогона; скачки позы не считаются путём."""

    def __init__(self) -> None:
        self._last: Point | None = None
        self._battery_start: float | None = None
        self._battery_now: float | None = None
        self.travelled_m = 0.0

    def record(self, position: Point, battery: float, pose_jump_m: float) -> None:
        if self._battery_start is None:
            self._battery_start = battery
        self._battery_now = battery
        if self._last is not None:
            step = distance_m(self._last, position)
            if step < pose_jump_m:
                self.travelled_m += step
        self._last = position

    def energy_per_m(self, min_travel_m: float) -> float | None:
        if self._battery_start is None or self.travelled_m < min_travel_m:
            return None
        return max(0.0, self._battery_start - self._battery_now) / self.travelled_m
