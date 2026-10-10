/**
 * The API for the end-to-end tests (started by playwright.config.ts):
 *
 * 1. creates a throwaway database on TEST_DATABASE_URL's server (@dwrg/db/testing),
 *    migrated, and loads the deterministic demo data into it (same as pnpm db:seed);
 * 2. gives the demo staff their logins (pnpm --filter @dwrg/api seed-auth);
 * 3. runs the API exactly as the Docker image does (node --import tsx src/server.ts)
 *    on API_PORT, allowing only WEB_ORIGIN;
 * 4. on SIGTERM or SIGINT (Playwright's shutdown) stops the API and drops the database.
 *
 * Nothing touches dwrg_dev or the TEST_DATABASE_URL database itself.
 *
 *   node --import tsx e2e/support/api-server.ts
 */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { loadRootEnv } from "@dwrg/db";
import { generateDemoData, seedDemoData } from "@dwrg/db/demo";
import { createTestDatabase, type TestDatabase } from "@dwrg/db/testing";
import { API_DIR, API_ORIGIN, API_PORT, E2E_HOST, WEB_ORIGIN } from "./config";

const STOP_GRACE_MS = 10_000;

const say = (message: string) => process.stdout.write(`[e2e api] ${message}\n`);

loadRootEnv();

let database: TestDatabase | undefined;
let api: ChildProcess | undefined;
let stopping = false;

async function stop(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    if (api && api.exitCode === null && api.signalCode === null) {
      api.kill("SIGTERM");
      const timer = setTimeout(() => api?.kill("SIGKILL"), STOP_GRACE_MS);
      await once(api, "exit");
      clearTimeout(timer);
    }
    if (database) {
      await database.close().catch((error: unknown) => {
        say(`couldn't drop ${database?.name}: ${String(error)}`);
      });
      say(`dropped ${database.name}`);
    }
  }
  process.exit(code);
}

process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

/** Runs a command to completion; rejects on a non-zero exit. */
async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, args, { cwd: API_DIR, env, stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) throw new Error(`${args.join(" ")} exited with ${code}\n${output}`);
}

async function main(): Promise<void> {
  const started = Date.now();
  database = await createTestDatabase({ max: 2 });
  const seeded = await seedDemoData(database.db, generateDemoData());
  say(`demo data loaded into ${database.name} in ${seeded.ms} ms`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DWRG_ENV: "e2e",
    APP_VERSION: "e2e",
    DATABASE_URL: database.url,
    HOST: E2E_HOST,
    PORT: String(API_PORT),
    BETTER_AUTH_URL: API_ORIGIN,
    WEB_ORIGIN,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-that-is-at-least-32-characters",
    LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? "warn",
  };

  await run("node", ["--import", "tsx", "src/scripts/seed-auth.ts"], env);
  say("demo logins ready (password demo-password-123)");

  api = spawn("node", ["--import", "tsx", "src/server.ts"], {
    cwd: API_DIR,
    env,
    stdio: "inherit",
  });
  api.on("exit", (code, signal) => {
    if (stopping) return;
    say(`the API stopped on its own (${signal ?? `exit ${code}`})`);
    void stop(1);
  });
  say(`API starting on ${API_ORIGIN} for ${WEB_ORIGIN} (${Date.now() - started} ms so far)`);
}

main().catch((error: unknown) => {
  say(`setup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  void stop(1);
});
