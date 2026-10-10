import { createDb, loadRootEnv } from "@dwrg/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { InvalidEnvError, parseEnv } from "./env";
import { createLogger, serializeError } from "./logger";

/**
 * Runs the API on Node (`pnpm --filter @dwrg/api dev` / `start`, and the
 * Docker image's `node --import tsx src/server.ts`).
 *
 * Settings come from the environment; locally the repo-root .env fills in
 * whatever isn't set. On SIGTERM (docker stop) or SIGINT it stops taking new
 * connections, lets requests in flight finish (up to SHUTDOWN_GRACE_MS), closes
 * the database pool and exits.
 */

const SHUTDOWN_GRACE_MS = 10_000;

loadRootEnv();

let env: ReturnType<typeof parseEnv>;
try {
  env = parseEnv();
} catch (error) {
  if (error instanceof InvalidEnvError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({
  level: env.LOG_LEVEL,
  base: { service: "api", env: env.DWRG_ENV, version: env.APP_VERSION },
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", { err: serializeError(reason) });
});

const database = createDb(env.DATABASE_URL);
const auth = createAuth({ db: database.db, env, logger });
const app = createApp({ db: database.db, auth, env, logger });

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info("listening", { host: info.address, port: info.port, nodeEnv: env.NODE_ENV });
});

server.on("error", (error) => {
  logger.error("server error", { err: serializeError(error) });
  process.exit(1);
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => {
    logger.warn("requests still running after the grace period; closing anyway", {
      graceMs: SHUTDOWN_GRACE_MS,
    });
    if ("closeAllConnections" in server) server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
  clearTimeout(force);
  try {
    await database.close();
  } catch (error) {
    logger.error("closing the database pool failed", { err: serializeError(error) });
  }
  logger.info("stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
