import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000"
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": sourceRoot } },
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: { "/api/v1": { target: backendUrl, changeOrigin: true } },
  },
  preview: { host: "0.0.0.0", port: 8080 },
  test: {
    css: { modules: { classNameStrategy: "non-scoped" } },
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["tests/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
          setupFiles: ["tests/setup/polyfills.ts", "tests/setup/dom.ts"],
        },
      },
    ],
  },
})
