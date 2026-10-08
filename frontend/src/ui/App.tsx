import { useEffect, useMemo, useState } from "react";
import type { MissionController } from "../application/missionController";
import type { FixtureControls } from "../adapters/fixture/fixtureGateway";
import { FIXTURE_SCENARIOS, type FixtureScenarioName } from "../adapters/fixture/scenarios";
import { JournalPanel } from "./JournalPanel";
import { MapView } from "./MapView";
import type { Point, TaskType } from "../domain/contract";
import { isMapMismatch } from "../domain/presentation";
import { isGoalLocked } from "../domain/navigationPresentation";
import { draftFromPoint, EMPTY_DRAFT, evaluateDraft, type NavigationDraft } from "../domain/navigationDraft";
import { MissionPanel } from "./MissionPanel";
import { NavigationDraftForm } from "./NavigationPanel";
import { ResearchPanel } from "./ResearchPanel";
import { TeamPanel } from "./TeamPanel";
import { useMission } from "./useMission";

interface AppProps {
  controller: MissionController;
  fixtureControls: FixtureControls | null;
}

export function App({ controller, fixtureControls }: AppProps) {
  const view = useMission(controller);
  const [scenario, setScenario] = useState<FixtureScenarioName>(fixtureControls?.getScenario() ?? "success");
  const stale = view.connection === "stale";
  const [taskType, setTaskType] = useState<TaskType>("research");
  const [draft, setDraft] = useState<NavigationDraft>(EMPTY_DRAFT);
  const currentMapId = view.map?.map_id ?? null;
  const goalLocked = isGoalLocked(view.snapshot);
  const mapMismatch = isMapMismatch(view.snapshot, view.map);
  const evaluation = useMemo(() => evaluateDraft(draft, view.map, mapMismatch), [draft, view.map, mapMismatch]);

  // потеря связи: выбор нужно подтвердить заново на актуальной карте
  useEffect(() => {
    if (view.connection !== "live") setDraft((current) => (current.mapId === null ? current : { ...current, mapId: null }));
  }, [view.connection]);

  const pickPoint = (point: Point) => setDraft(draftFromPoint(point, currentMapId));
  const lockedReason = goalLocked
    ? "Миссия выполняется: цель изменить нельзя. Нажмите Stop, чтобы выбрать другую точку."
    : null;
  const picker = taskType === "navigation" ? { lockedReason, onPick: pickPoint } : null;
  const task = {
    taskType,
    onTaskTypeChange: setTaskType,
    target: evaluation.target,
    navigationBlock: evaluation.problem === null ? null : `точка не готова — ${evaluation.problem === "empty" ? "не выбрана" : "см. пояснение под полями"}`,
    form: (
      <NavigationDraftForm
        draft={draft}
        evaluation={evaluation}
        snapshot={view.snapshot}
        onChange={(next) => setDraft({ ...next, mapId: currentMapId })}
        onConfirm={() => setDraft((current) => ({ ...current, mapId: currentMapId }))}
      />
    ),
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Автономный исследователь</h1>
        {fixtureControls !== null && (
          <>
            <span className="demo-badge" role="status">Демо-данные</span>
            <label className="inline-field">
              Сценарий демо
              <select
                value={scenario}
                onChange={(event) => {
                  const next = event.target.value as FixtureScenarioName;
                  setScenario(next);
                  fixtureControls.setScenario(next);
                }}
                disabled={view.snapshot !== null && view.command.phase !== "idle" && view.command.phase !== "failed"}
              >
                {FIXTURE_SCENARIOS.map((scenario) => (
                  <option key={scenario.name} value={scenario.name}>{scenario.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className={`connection ${stale ? "connection-stale" : "connection-live"}`} role="status">
          {view.connection === "live" ? "Связь есть" : view.connection === "connecting" ? "Подключение…" : view.snapshot === null ? "Нет связи с backend" : "Данные устарели"}
        </span>
      </header>

      {stale && (
        <p className="notice notice-warning banner" role="alert">
          Нет ответа backend больше 3 секунд{view.connectionError ? ` (${view.connectionError})` : ""}. Показаны последние
          известные значения; обновление возобновится автоматически.
        </p>
      )}

      <main className="layout">
        <MapView
          map={view.map}
          snapshot={view.snapshot}
          mapError={view.mapError}
          stale={stale}
          draftTarget={taskType === "navigation" && !goalLocked ? evaluation.point : null}
          picker={picker}
        />
        <div className="side">
          <MissionPanel view={view} controller={controller} task={task} />
          <TeamPanel snapshot={view.snapshot} />
          <ResearchPanel snapshot={view.snapshot} />
          <JournalPanel view={view} controller={controller} />
        </div>
      </main>
    </div>
  );
}
