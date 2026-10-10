import { existsSync } from "node:fs";
import { defineConfig, devices, type Project, webkit } from "@playwright/test";
import { API_ORIGIN, E2E_HOST, IPAD_PORTRAIT, WEB_ORIGIN, WEB_PORT } from "./e2e/support/config";

/**
 * End-to-end tests at iPad size (CLAUDE.md rule 9; docs/04 "what done means").
 *
 * - ipad-webkit: Safari's engine, as on the techs' iPads. CI installs WebKit
 *   and runs this project. Left out locally when WebKit isn't installed, so a
 *   plain `pnpm --filter @dwrg/web e2e` runs what the machine has.
 * - ipad-chromium: the same iPad screen in Chromium, for machines without
 *   WebKit. Uses CHROMIUM_PATH, or /opt/pw-browsers/chromium when present.
 *
 * Both start their own API on a throwaway database with the demo data
 * (e2e/support/api-server.ts) and the web dev server pointed at it.
 *
 *   pnpm --filter @dwrg/web e2e --project=ipad-chromium
 *
 * E2E_REUSE=1 reuses servers already running on the e2e ports (a quicker
 * second run while writing tests; the database then keeps earlier runs' writes).
 */

const ipad = devices["iPad (gen 7)"];
const reuse = process.env.E2E_REUSE === "1";

const chromiumPath =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

function webkitInstalled(): boolean {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
}

const ipadWebkit: Project = {
  name: "ipad-webkit",
  use: { ...ipad, viewport: IPAD_PORTRAIT, browserName: "webkit" },
};

const ipadChromium: Project = {
  name: "ipad-chromium",
  use: {
    ...ipad,
    viewport: IPAD_PORTRAIT,
    browserName: "chromium",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // The specs share one API and database; two workers keep the run short without crowding it.
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    locale: "en-US",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // In CI WebKit is always in the list, so a missing install fails loudly.
  projects: process.env.CI || webkitInstalled() ? [ipadWebkit, ipadChromium] : [ipadChromium],
  webServer: [
    {
      name: "api",
      command: "node --import tsx e2e/support/api-server.ts",
      url: `${API_ORIGIN}/health`,
      // Creating the database, loading a year of demo data and hashing 13 passwords.
      timeout: 180_000,
      reuseExistingServer: reuse,
      stdout: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      name: "web",
      command: `pnpm exec vite --host ${E2E_HOST} --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      env: { VITE_API_URL: API_ORIGIN },
      timeout: 120_000,
      reuseExistingServer: reuse,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
