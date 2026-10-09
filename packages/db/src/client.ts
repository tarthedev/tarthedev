import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
/** A transaction handle from `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DbHandle {
  db: Database;
  /** The underlying postgres.js client, for raw SQL and LISTEN/NOTIFY. */
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Maximum pool size (default 10). */
  max?: number;
  /** Log every query to the console. */
  logger?: boolean;
}

/**
 * Connects to Postgres. Note: Drizzle switches the client's date/time parsers
 * to return strings, so raw `sql` queries get timestamps as ISO-like strings.
 */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema, logger: options.logger ?? false });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
