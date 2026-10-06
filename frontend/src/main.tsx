import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browserScheduler } from "./adapters/browserScheduler";
import { FixtureMissionGateway } from "./adapters/fixture/fixtureGateway";
import { HttpMissionGateway } from "./adapters/httpGateway";
import { MissionController } from "./application/missionController";
import { App } from "./ui/App";
import "./ui/styles.css";

type DataSource = "live" | "fixture";

/** Режим задаётся явно: /config.json контейнера или VITE_DATA_SOURCE при разработке; по умолчанию live. */
async function resolveDataSource(): Promise<DataSource> {
  try {
    const response = await fetch("/config.json", { headers: { Accept: "application/json" } });
    if (response.ok) {
      const config: unknown = await response.json();
      const source = (config as { data_source?: unknown }).data_source;
      if (source === "fixture" || source === "live") return source;
    }
  } catch {
    // нет config.json (dev-сервер) — используем переменную сборки
  }
  return import.meta.env.VITE_DATA_SOURCE === "fixture" ? "fixture" : "live";
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Не найден корневой элемент #root");
const root = createRoot(rootElement);

void resolveDataSource().then((source) => {
  const fixture = source === "fixture" ? new FixtureMissionGateway() : null;
  const controller = new MissionController({
    gateway: fixture ?? new HttpMissionGateway(),
    scheduler: browserScheduler,
    generateId: () => crypto.randomUUID(),
  });
  root.render(
    <StrictMode>
      <App controller={controller} fixtureControls={fixture} />
    </StrictMode>,
  );
});
