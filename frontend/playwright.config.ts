import { defineConfig, devices } from "@playwright/test"

const PORT = 4317
const BUILD_DIR = "node_modules/.cache/e2e-dist"
const WIDTHS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const
const MOTIONS = ["normal", "reduce"] as const

const scenarioProjects = WIDTHS.flatMap((viewport) =>
  MOTIONS.map((motion) => ({
    name: `${viewport.width}-${motion}`,
    testMatch: /(scenarios|controls|locale|show)\.spec\.ts/,
    metadata: { width: viewport.width, motion },
    use: {
      ...devices["Desktop Chrome"],
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: motion === "reduce" ? ("reduce" as const) : ("no-preference" as const),
    },
  })),
)

export default defineConfig({
  testDir: "e2e",
  outputDir: "node_modules/.cache/e2e-results",
  fullyParallel: true,
  timeout: 180_000,
  reporter: [["list"]],
  globalTeardown: "./e2e/axeSummary.ts",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    ...scenarioProjects,
    {
      name: "fps",
      testMatch: /fps\.spec\.ts/,
      metadata: { width: 1920, motion: "normal" },
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `npx vite build --outDir ${BUILD_DIR} --emptyOutDir && npx vite preview --outDir ${BUILD_DIR} --port ${PORT} --strictPort`,
    env: { VITE_DATA_SOURCE: "fixture" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
