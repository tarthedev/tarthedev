import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Absolute path of the generated SQL migrations (packages/db/drizzle). */
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies every pending migration to the database at `url`. Safe to run repeatedly. */
export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
