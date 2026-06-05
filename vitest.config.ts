import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Vitest runs the frontend's pure-TypeScript modules under a `happy-dom`
// environment. Components that call into `@tauri-apps/api` aren't testable
// here without a separate IPC mock layer; we focus on the dependency-free
// utils (curl parsing, JSONPath evaluation, variable substitution, diff,
// etc.) which deliver high signal for low setup.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
