import { defineConfig } from "vitest/config";

// Each test file creates and migrates its own throwaway database
// (@dwrg/db/testing), and password hashing is deliberately slow, so these
// tests need more time than the default 5 s.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
