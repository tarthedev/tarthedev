import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb, type Database } from "./client";
import { requireEnv } from "./env";
import { runMigrations } from "./migrations";

/**
 * Throwaway databases for tests (import from "@dwrg/db/testing").
 *
 * `createTestDatabase()` creates a uniquely named database on the server in
 * TEST_DATABASE_URL (which is only used as the admin connection), applies all
 * migrations, and returns a client. `close()` disconnects and drops it, so the
 * TEST_DATABASE_URL database itself is never touched.
 *
 *   let t: TestDatabase;
 *   beforeAll(async () => { t = await createTestDatabase(); });
 *   afterAll(async () => { await t.close(); });
 */

export const TEST_DATABASE_PREFIX = "dwrg_tmp_";

export interface TestDatabase {
  /** Connection URL of the new database. */
  url: string;
  /** Database name. */
  name: string;
  db: Database;
  sql: postgres.Sql;
  /** Disconnects and drops the database. Safe to call twice. */
  close: () => Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** Apply migrations (default true). */
  migrate?: boolean;
  /** Pool size for the returned client (default 5). */
  max?: number;
}

export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const adminUrl = requireEnv("TEST_DATABASE_URL");
  const name = `${TEST_DATABASE_PREFIX}${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  await withAdmin(adminUrl, (admin) => admin.unsafe(`create database "${name}"`));

  const url = databaseUrl(adminUrl, name);
  try {
    if (options.migrate ?? true) await runMigrations(url);
  } catch (error) {
    await dropDatabase(adminUrl, name);
    throw error;
  }

  const handle = createDb(url, { max: options.max ?? 5 });
  let closed = false;
  return {
    url,
    name,
    db: handle.db,
    sql: handle.sql,
    close: async () => {
      if (closed) return;
      closed = true;
      await handle.close();
      await dropDatabase(adminUrl, name);
    },
  };
}

/**
 * Drops leftover test databases (from crashed runs) older than `olderThanMs`
 * (default one hour). Returns the names dropped.
 */
export async function dropStaleTestDatabases(olderThanMs = 60 * 60 * 1000): Promise<string[]> {
  const adminUrl = requireEnv("TEST_DATABASE_URL");
  const cutoff = Date.now() - olderThanMs;
  const rows = await withAdmin(
    adminUrl,
    (admin) =>
      admin<{ datname: string }[]>`
        select datname from pg_database where datname like ${`${TEST_DATABASE_PREFIX}%`}
      `,
  );
  const stale = rows
    .map((r) => r.datname)
    .filter((name) => {
      const stamp = name.slice(TEST_DATABASE_PREFIX.length).split("_")[0] ?? "";
      const created = Number.parseInt(stamp, 36);
      return Number.isFinite(created) && created < cutoff;
    });
  for (const name of stale) await dropDatabase(adminUrl, name);
  return stale;
}

/** The same server and credentials as `url`, pointed at database `name`. */
export function databaseUrl(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  if (!name.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(`Refusing to drop ${name}: not a test database`);
  }
  // A new database soon gets an autovacuum worker (it analyzes the catalogs the
  // migrations filled). The worker runs as the bootstrap superuser, which a
  // non-superuser's DROP ... WITH (FORCE) may not terminate: "permission denied
  // to terminate process" (42501). It finishes within moments, so try again.
  for (let attempt = 1; ; attempt++) {
    try {
      await withAdmin(adminUrl, (admin) =>
        admin.unsafe(`drop database if exists "${name}" with (force)`),
      );
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "42501" || attempt >= DROP_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, DROP_RETRY_MS * attempt));
    }
  }
}

const DROP_ATTEMPTS = 8;
const DROP_RETRY_MS = 250;

async function withAdmin<T>(adminUrl: string, fn: (admin: postgres.Sql) => Promise<T>): Promise<T> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(admin);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
