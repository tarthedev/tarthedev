/**
 * A problem with one row (or one group of rows) that rejects it without
 * stopping the import. The message is shown on the Import page as is.
 */
export class RowError extends Error {
  override name = "RowError";

  constructor(
    message: string,
    /** The row the problem is on, when it is one row of a group. */
    readonly rowNumber?: number,
    /** The file column the problem is in. */
    readonly column?: string,
  ) {
    super(message);
  }
}

/** A problem with the whole file or call (wrong columns, unknown user, bad summary). */
export class StImportError extends Error {
  override name = "StImportError";
}

/** An import that failed unexpectedly. The failed batch was recorded under `batchId`. */
export class StImportFailedError extends Error {
  override name = "StImportFailedError";

  constructor(
    message: string,
    readonly batchId: string | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

interface PgErrorFields {
  code?: string;
  detail?: string;
  constraint_name?: string;
  table_name?: string;
  column_name?: string;
  message?: string;
}

/** The Postgres error behind a Drizzle query error, if there is one. */
export function postgresErrorOf(error: unknown): PgErrorFields | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const fields = current as PgErrorFields & { cause?: unknown };
    if (typeof fields.code === "string" && /^[0-9A-Z]{5}$/.test(fields.code)) return fields;
    current = fields.cause;
  }
  return null;
}

/**
 * Data problems the database caught (a duplicate number, a value breaking a
 * rule) reject the row; anything else is a bug or an outage and stops the import.
 */
export function isRowLevelDatabaseError(error: unknown): boolean {
  const pg = postgresErrorOf(error);
  return pg?.code !== undefined && (pg.code.startsWith("23") || pg.code.startsWith("22"));
}

/** A database error in words for the Import page. */
export function describeDatabaseError(error: unknown): string {
  const pg = postgresErrorOf(error);
  if (!pg) return error instanceof Error ? error.message : String(error);
  const where = pg.table_name ? ` in ${pg.table_name.replaceAll("_", " ")}` : "";
  switch (pg.code) {
    case "23505": {
      const detail = /Key \((.+)\)=\((.*)\) already exists/.exec(pg.detail ?? "");
      return detail
        ? `Another row${where} already has ${detail[1]} "${detail[2]}".`
        : `Duplicate value${where} (${pg.constraint_name ?? "unique rule"}).`;
    }
    case "23503":
      return `Refers to a row that doesn't exist${where} (${pg.constraint_name ?? "foreign key"}).`;
    case "23514":
      return `A value breaks the rule ${pg.constraint_name ?? "check"}${where}.`;
    case "23502":
      return `${pg.column_name ?? "A required value"} is missing${where}.`;
    default:
      return pg.message ?? "Database error.";
  }
}
