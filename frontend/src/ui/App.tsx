import { useState } from "react";
import type { MissionController } from "../application/missionController";
import type { FixtureControls } from "../adapters/fixture/fixtureGateway";
import { FIXTURE_SCENARIOS, type FixtureScenarioName } from "../adapters/fixture/scenarios";
import { JournalPanel } from "./JournalPanel";
import { MapView } from "./MapView";
import { MissionPanel } from "./MissionPanel";
import { ResearchPanel } from "./ResearchPanel";
import { useMission } from "./useMission";

interface AppProps {
  controller: MissionController;
  fixtureControls: FixtureControls | null;
}

export function App({ controller, fixtureControls }: AppProps) {
  const view = useMission(controller);
  const [scenario, setScenario] = useState<FixtureScenarioName>(fixtureControls?.getScenario() ?? "success");
  const stale = view.connection === "stale";

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
        <MapView map={view.map} snapshot={view.snapshot} mapError={view.mapError} stale={stale} />
        <div className="side">
          <MissionPanel view={view} controller={controller} />
          <ResearchPanel snapshot={view.snapshot} />
          <JournalPanel view={view} controller={controller} />
        </div>
      </main>
    </div>
  );
}
