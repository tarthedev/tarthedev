import type { Database } from "@dwrg/db";
import type { HealthResponse } from "@dwrg/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import type { ApiEnv } from "../env";
import { serializeError } from "../logger";

/** How long the database gets to answer `SELECT 1` before /health says 503. */
export const HEALTH_DB_TIMEOUT_MS = 2000;

/**
 * GET /health, no login (docs/runbooks/monitoring.md, "The /health contract"):
 * 200 { status: "ok" } when Postgres answers `SELECT 1` within 2 seconds,
 * 503 { status: "unavailable" } otherwise. Docker's healthcheck, deploy.sh and
 * the uptime service all read it. It shows nothing secret.
 */
export function healthRoutes({ db, env }: { db: Database; env: Pick<ApiEnv, "APP_VERSION"> }) {
  return new Hono<AppEnv>().get("/health", async (c) => {
    const database = await checkDatabase(db).catch((error: unknown) => {
      c.get("log").error("health check: database down", { err: serializeError(error) });
      return "down" as const;
    });
    const body: HealthResponse = {
      status: database === "ok" ? "ok" : "unavailable",
      database,
      version: env.APP_VERSION,
    };
    return c.json(body, database === "ok" ? 200 : 503);
  });
}

async function checkDatabase(db: Database): Promise<"ok"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${HEALTH_DB_TIMEOUT_MS} ms`)),
      HEALTH_DB_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return "ok";
  } finally {
    clearTimeout(timer);
  }
}
