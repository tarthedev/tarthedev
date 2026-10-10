import { defineConfig } from "vitest/config";

/**
 * Unit and component tests (Vitest + Testing Library in jsdom). The browser
 * tests at iPad size are Playwright's (playwright.config.ts, e2e/).
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
