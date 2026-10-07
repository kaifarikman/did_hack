import { useState } from "react";
import { MAP_MODES, SCENARIOS, type MapMode, type Scenario } from "../domain/contract";
import type { MissionController } from "../application/missionController";
import { startDisabledReason, stopDisabledReason, type MissionViewState } from "../application/viewState";
import {
  batteryRatio,
  formatBattery,
  formatReturnEstimate,
  formatSampleSignal,
  formatSimulationTime,
  goalLabel,
  judgeLabel,
  outcomeKind,
  plannerLabel,
  statusLabel,
  statusMark,
  statusTone,
  type OutcomeKind,
} from "../domain/presentation";

interface MissionPanelProps {
  view: MissionViewState;
  controller: MissionController;
}

const OUTCOME_TEXT: Record<Exclude<OutcomeKind, "none">, string> = {
  success: "Миссия завершена успешно: судья подтвердил завершение.",
  interrupted: "Миссия прервана пользователем. Это не успешное завершение.",
  failure: "Миссия завершилась ошибкой. Успех не засчитан.",
};

export function MissionPanel({ view, controller }: MissionPanelProps) {
  const [seedText, setSeedText] = useState("42");
  const [scenario, setScenario] = useState<Scenario>("easy");
  const [missionText, setMissionText] = useState("");
  const [mapMode, setMapMode] = useState<MapMode>("static");
  const [robotCount, setRobotCount] = useState(1);
  const { snapshot, health, command } = view;
  const supported = health?.supported_scenarios ?? ["easy"];
  const mapModes = health?.supported_map_modes ?? ["static"];
  const robotCounts = health?.supported_robot_counts ?? [1];
  const seed = Number(seedText);
  const seedValid = seedText.trim() !== "" && Number.isInteger(seed);
  const startReason =
    startDisabledReason(view) ??
    (seedValid ? null : "seed должен быть целым числом") ??
    (supported.includes(scenario) ? null : `профиль ${scenario} не поддерживается средой`) ??
    (mapModes.includes(mapMode) ? null : "режим карты не поддерживается средой") ??
    (robotCounts.includes(robotCount) ? null : "столько роботов среда не поднимает");
  const stopReason = stopDisabledReason(view);
  const ratio = snapshot === null ? null : batteryRatio(snapshot.battery_remaining, snapshot.battery_initial);
  const outcome = snapshot === null ? "none" : outcomeKind(snapshot.status);
  const goal = snapshot?.current_goal ?? null;

  return (
    <section className="panel" aria-labelledby="mission-title">
      <h2 id="mission-title">Миссия</h2>

      {snapshot === null ? (
        <p className="notice notice-warning" role="status">
          Нет данных о миссии{view.connectionError ? `: ${view.connectionError}` : "…"}
        </p>
      ) : (
        <>
          <p className={`status-badge tone-${statusTone(snapshot.status)}`} data-testid="status">
            <span aria-hidden="true">{statusMark(snapshot.status)}</span> {statusLabel(snapshot.status)}
          </p>
          {outcome !== "none" && <p className={`notice notice-${outcome}`} role="status">{OUTCOME_TEXT[outcome]}</p>}

          <div className="chips">
            <span className="chip">{judgeLabel(snapshot.judge_mode)}</span>
            <span className="chip">{plannerLabel(snapshot.planner_mode)}</span>
            <span className="chip">
              {health === null ? "Среда: неизвестно" : health.status === "ready" ? "Среда: готова" : "Среда: запускается"}
              {health !== null && !health.ros_connected ? ", ROS не подключён" : ""}
              {health !== null && !health.llm_available ? ", LLM недоступен" : ""}
            </span>
          </div>

          <dl className="metrics">
            <dt>Время симуляции</dt>
            <dd>{formatSimulationTime(snapshot.simulation_time_s)}</dd>
            <dt>Батарея</dt>
            <dd>
              {formatBattery(snapshot.battery_remaining, snapshot.battery_initial)}
              {ratio !== null && <meter min={0} max={1} value={ratio} aria-label="Остаток батареи в условных единицах" />}
            </dd>
            <dt>Оценка энергии возврата</dt>
            <dd>{formatReturnEstimate(snapshot.return_energy_estimate)}</dd>
            <dt>Сигнал образца</dt>
            <dd>{formatSampleSignal(snapshot.sample_signal)}</dd>
            <dt>Подтверждённых сборов</dt>
            <dd>
              {snapshot.samples_collected}
              {snapshot.target_samples !== null && ` из возможных в профиле ${snapshot.target_samples}`}
            </dd>
            <dt>Прогон</dt>
            <dd>
              {snapshot.run_id ?? "нет данных"}
              {snapshot.scenario !== null && ` · ${snapshot.scenario}`}
              {snapshot.map_mode === "slam" && " · SLAM"}
              {snapshot.seed !== null && ` · seed ${snapshot.seed}`}
            </dd>
          </dl>

          {snapshot.mission_text !== "" && (
            <p className="mission-text"><strong>Миссия:</strong> {snapshot.mission_text}</p>
          )}

          <div className="goal">
            <h3>Текущая цель</h3>
            {goal === null ? (
              <p>Цели нет</p>
            ) : (
              <p>
                <strong>{goalLabel(goal.kind)}.</strong> {goal.reason}
              </p>
            )}
          </div>

          {snapshot.last_error !== null && (
            <p className="notice notice-failure" role="alert">
              Ошибка {snapshot.last_error.code}: {snapshot.last_error.message}
              {snapshot.last_error.retryable ? " (можно повторить)" : ""}
            </p>
          )}
        </>
      )}

      <label className="mission-field">
        Текст миссии (необязательно)
        <textarea
          rows={2}
          maxLength={500}
          value={missionText}
          placeholder="Собрать как можно больше образцов и вернуться на базу"
          onChange={(event) => setMissionText(event.target.value)}
        />
      </label>
      <div className="controls">
        <label className="seed-field">
          Профиль
          <select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>
            {SCENARIOS.map((name) => (
              <option key={name} value={name} disabled={!supported.includes(name)}>
                {name}
                {supported.includes(name) ? "" : " (нет в среде)"}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-field">
          Карта
          <select value={mapMode} onChange={(event) => setMapMode(event.target.value as MapMode)}>
            {MAP_MODES.map((mode) => (
              <option key={mode} value={mode} disabled={!mapModes.includes(mode)}>
                {mode === "static" ? "готовая" : "SLAM"}
                {mapModes.includes(mode) ? "" : " (нет в среде)"}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-field">
          Роботов
          <select value={robotCount} onChange={(event) => setRobotCount(Number(event.target.value))}>
            {[1, 2].map((count) => (
              <option key={count} value={count} disabled={!robotCounts.includes(count)}>
                {count}
                {robotCounts.includes(count) ? "" : " (нет в среде)"}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-field">
          seed
          <input
            type="text"
            inputMode="numeric"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
            aria-invalid={!seedValid}
          />
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={startReason !== null}
          aria-describedby="command-hint"
          onClick={() => void controller.startRun(seed, scenario, missionText, mapMode, robotCount)}
        >
          Start
        </button>
        <button
          type="button"
          className="button-danger"
          disabled={stopReason !== null}
          aria-describedby="command-hint"
          onClick={() => void controller.stopRun()}
        >
          Stop
        </button>
      </div>
      <p id="command-hint" className="hint">
        {startReason !== null && stopReason !== null ? `Start: ${startReason}. Stop: ${stopReason}.` : " "}
      </p>

      {command.message !== null && (
        <div className={`notice ${command.phase === "failed" ? "notice-failure" : "notice-warning"}`} role="status">
          <p>{command.message}</p>
          {command.phase === "unknown" && (
            <button type="button" disabled={!command.canRetry} onClick={() => void controller.retryCommand()}>
              Повторить команду
            </button>
          )}
          {command.phase === "failed" && (
            <button type="button" onClick={() => controller.dismissCommandMessage()}>
              Закрыть
            </button>
          )}
        </div>
      )}
      {command.phase === "sending" && <p className="hint" role="status">Отправка команды…</p>}
    </section>
  );
}
