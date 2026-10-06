import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: { "/api/v1": { target: backendUrl, changeOrigin: true } },
  },
  preview: { host: "0.0.0.0", port: 8080 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
