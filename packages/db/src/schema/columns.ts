import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, date, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Column conventions from docs/05-data-model.md:
 * - uuid primary keys (random) on business tables
 * - money is integer cents (`*_cents`), rates are integer basis points (`*_bps`)
 * - created_at / updated_at (timestamptz), created_by (user id) on business rows
 * - deleted_at soft delete on business rows
 * - st_id (ServiceTitan ID) with a unique index on rows that can be imported
 * - business-local calendar days (America/New_York) are `date` columns as
 *   'YYYY-MM-DD' strings
 */

const tz = { withTimezone: true, mode: "date" } as const;

export const timestamptz = (name: string) => timestamp(name, tz);

/** A business-local calendar day ('YYYY-MM-DD', America/New_York). */
export const localDate = (name: string) => date(name, { mode: "string" });

export const pk = () => uuid("id").primaryKey().defaultRandom();

/** Integer cents. Never floating point. */
export const cents = (name: string) => integer(name);

/** Integer basis points: 10000 = 100%. */
export const bps = (name: string) => integer(name);

/** ServiceTitan ID for rows that can come from a report export. Unique where set. */
export const stId = () => text("st_id");

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** The user who created the row; null for system jobs, imports and the seed. */
export const createdBy = () => text("created_by").references((): AnyPgColumn => user.id);

/** A nullable reference to a user (Better Auth ids are text). */
export const userRef = (name: string) => text(name).references((): AnyPgColumn => user.id);

export const auditColumns = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: createdBy(),
});

export const softDelete = () => ({
  deletedAt: timestamptz("deleted_at"),
});

/** `column in ('a', 'b', ...)` for CHECK constraints built from the lists in enums.ts. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(quote).join(", "))})`;
}

/** `column <@ array['a', 'b', ...]` for text[] columns limited to a list. */
export function subsetOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} <@ array[${sql.raw(values.map(quote).join(", "))}]::text[]`;
}

function quote(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`Unexpected enum value for a CHECK constraint: ${value}`);
  }
  return `'${value}'`;
}
