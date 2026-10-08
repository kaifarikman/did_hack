import type { MissionSnapshot } from "../domain/contract";
import {
  describeUserGoal,
  isGoalLocked,
  navigationOutcome,
  navigationPhaseLabel,
  navigationStages,
} from "../domain/navigationPresentation";
import { draftProblemText, type DraftEvaluation, type NavigationDraft } from "../domain/navigationDraft";

interface NavigationRunPanelProps {
  snapshot: MissionSnapshot;
}

/** Состояние пользовательской цели: отдельно от подцели робота и от общего статуса миссии. */
export function NavigationRunPanel({ snapshot }: NavigationRunPanelProps) {
  const navigation = snapshot.navigation;
  if (navigation === null) return null;
  const outcome = navigationOutcome(snapshot);
  const subgoal = snapshot.current_goal;
  const stages = navigationStages(snapshot);

  return (
    <div className="nav-run" data-testid="navigation-run">
      <h3>Цель пользователя</h3>
      <dl className="metrics">
        <dt>Точка</dt>
        <dd data-testid="user-goal">{describeUserGoal(navigation)}</dd>
        <dt>Допуск прибытия</dt>
        <dd>{navigation.arrival_tolerance_m.toFixed(2)} м</dd>
        <dt>Цель достигнута</dt>
        <dd data-testid="target-reached">
          {navigation.target_reached
            ? `да${navigation.target_reached_at_s === null ? "" : `, ${navigation.target_reached_at_s.toFixed(1)} с симуляции`}`
            : "нет"}
        </dd>
        <dt>Этап</dt>
        <dd data-testid="navigation-phase">{navigationPhaseLabel(navigation.phase)}</dd>
        <dt>Подцель робота</dt>
        <dd>{subgoal === null ? "нет" : `${SUBGOAL_LABEL[subgoal.kind]}: ${subgoal.reason}`}</dd>
        <dt>Маршрут</dt>
        <dd>
          {snapshot.planned_path.length > 1
            ? `${snapshot.planned_path.length} точек, ревизия ${snapshot.route_revision}`
            : "не построен"}
        </dd>
      </dl>
      <ol className="stages" aria-label="Этапы навигации">
        {stages.map((stage) => (
          <li key={stage.id} className={`stage stage-${stage.state}`} data-state={stage.state}>
            <span aria-hidden="true">{STAGE_MARK[stage.state]}</span> {stage.label}
            <span className="visually-hidden"> — {STAGE_TEXT[stage.state]}</span>
          </li>
        ))}
      </ol>
      {outcome !== null && (
        <p className={`notice notice-nav-${outcome.kind}`} role="status" data-testid="navigation-outcome">
          <strong>{outcome.title}.</strong> {outcome.detail}
        </p>
      )}
    </div>
  );
}

const SUBGOAL_LABEL = {
  explore: "Исследование",
  approach: "Движение к цели",
  collect: "Сбор образца",
  return: "Возврат на базу",
} as const;

const STAGE_MARK = { done: "✔", current: "▶", todo: "○", failed: "✖" } as const;
const STAGE_TEXT = { done: "выполнено", current: "выполняется", todo: "ожидает", failed: "не выполнено" } as const;

interface NavigationDraftFormProps {
  draft: NavigationDraft;
  evaluation: DraftEvaluation;
  snapshot: MissionSnapshot | null;
  onChange: (next: { xText: string; yText: string }) => void;
  onConfirm: () => void;
}

/** Ввод координат и состояние выбранной точки до отправки. */
export function NavigationDraftForm({ draft, evaluation, snapshot, onChange, onConfirm }: NavigationDraftFormProps) {
  const locked = isGoalLocked(snapshot);
  const showProblem = evaluation.problem !== null && evaluation.problem !== "empty";
  const needsConfirm = evaluation.problem === "map_changed";
  return (
    <fieldset className="nav-draft" disabled={locked}>
      <legend>Заданная точка (метры в системе карты)</legend>
      <div className="controls">
        <label className="seed-field">
          X, м
          <input
            type="text"
            inputMode="decimal"
            value={draft.xText}
            aria-invalid={showProblem && evaluation.point === null}
            aria-describedby="nav-draft-status"
            onChange={(event) => onChange({ xText: event.target.value, yText: draft.yText })}
          />
        </label>
        <label className="seed-field">
          Y, м
          <input
            type="text"
            inputMode="decimal"
            value={draft.yText}
            aria-invalid={showProblem && evaluation.point === null}
            aria-describedby="nav-draft-status"
            onChange={(event) => onChange({ xText: draft.xText, yText: event.target.value })}
          />
        </label>
        {needsConfirm && (
          <button type="button" onClick={onConfirm}>Подтвердить точку</button>
        )}
      </div>
      <p id="nav-draft-status" className="hint" role="status" data-testid="draft-status">
        {locked
          ? "Миссия выполняется: цель изменить нельзя. Остановите миссию (Stop), чтобы выбрать другую точку."
          : evaluation.target !== null
            ? `Выбрана точка X ${evaluation.target.position_x_m} м, Y ${evaluation.target.position_y_m} м на карте ${shortMapId(evaluation.target.map_id)}. Робот пока не двигается. Достижимость проверит backend при запуске.`
            : evaluation.problem !== null
              ? draftProblemText(evaluation.problem)
              : " "}
        {!locked && evaluation.warning !== null && ` ${evaluation.warning}`}
      </p>
    </fieldset>
  );
}

function shortMapId(mapId: string): string {
  return mapId.length > 18 ? `${mapId.slice(0, 15)}…` : mapId;
}
