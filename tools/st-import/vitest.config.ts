import { defineConfig } from "vitest/config";

// Database tests create, migrate and fill their own throwaway database, so
// they need more time than the default 5 s.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
