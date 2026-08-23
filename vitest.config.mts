import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // env.ts validates configuration at import time, so test env vars must be
    // in place before any module under test is loaded.
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
