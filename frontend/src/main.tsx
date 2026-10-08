import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { browserScheduler } from "./adapters/browserScheduler"
import { FixtureMissionGateway } from "./adapters/fixture/fixtureGateway"
import { HttpMissionGateway } from "./adapters/httpGateway"
import { createRequestId } from "./adapters/requestId"
import { MissionController } from "./application/missionController"
import { AppShell } from "./ui/app"
import { LocaleProvider } from "./ui/shared/i18n"
import "./ui/shared/styles/global.css"

type DataSource = "live" | "fixture"

const CONFIG_TIMEOUT_MS = 2000

async function readConfiguredSource(): Promise<DataSource | null> {
  try {
    const response = await fetch("/config.json", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const config: unknown = await response.json()
    const source = (config as { data_source?: unknown }).data_source
    return source === "fixture" || source === "live" ? source : null
  } catch {
    return null
  }
}

async function resolveDataSource(): Promise<DataSource> {
  const configured = await readConfiguredSource()
  if (configured !== null) return configured
  return import.meta.env.VITE_DATA_SOURCE === "fixture" ? "fixture" : "live"
}

const rootElement = document.getElementById("root")
if (rootElement === null) throw new Error("Root element #root not found")
const root = createRoot(rootElement)

void resolveDataSource().then((source) => {
  const fixture = source === "fixture" ? new FixtureMissionGateway() : null
  const controller = new MissionController({
    gateway: fixture ?? new HttpMissionGateway(),
    scheduler: browserScheduler,
    generateId: () => createRequestId(),
  })
  root.render(
    <StrictMode>
      <LocaleProvider>
        <AppShell controller={controller} fixtureControls={fixture} />
      </LocaleProvider>
    </StrictMode>,
  )
})
