import { defineConfig } from "vitest/config";

// Database tests create and migrate their own throwaway database, so they
// need more time than the default 5 s.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
