import {
  type AuditAction,
  type AuditContext,
  type Executor,
  type TableWithId,
  type TableWithSoftDelete,
  type UpsertResult,
  writeAudit,
} from "@dwrg/db";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";

/**
 * Audited writes for imports, without savepoints.
 *
 * They write exactly what @dwrg/db's insertWithAudit / updateWithAudit /
 * upsertWithAudit / softDeleteWithAudit write (the change plus an audit_log
 * row with who, when, before, after and why, CLAUDE.md rule 4), but they
 * don't open a savepoint per call. A full-history import makes tens of
 * thousands of writes in one transaction; a savepoint each holds a lock per
 * subtransaction until commit and exhausts Postgres's lock table
 * (max_locks_per_transaction), besides slowing every other session.
 * Callers run them inside the import transaction, which is all or nothing.
 */

function rowId(row: unknown): string {
  const id = (row as { id?: unknown }).id;
  if (id === undefined || id === null) throw new Error("row has no id");
  return String(id);
}

async function insertRow<T extends TableWithId>(
  tx: Executor,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  const [row] = (await tx
    .insert(table)
    .values(values as PgInsertValue<T>)
    .returning()) as T["$inferSelect"][];
  if (!row) throw new Error(`insert into ${getTableName(table)} returned no row`);
  return row;
}

async function updateRow<T extends TableWithId>(
  tx: Executor,
  table: T,
  id: string,
  patch: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  const [row] = (await tx
    .update(table)
    .set(patch as PgUpdateSetSource<T>)
    .where(eq(table.id, id))
    .returning()) as T["$inferSelect"][];
  if (!row) throw new Error(`${getTableName(table)} ${id} not found`);
  return row;
}

async function lockRow<T extends TableWithId>(
  tx: Executor,
  table: T,
  column: PgColumn,
  value: string,
): Promise<T["$inferSelect"] | undefined> {
  const [row] = (await tx
    .select()
    .from(table as PgTable)
    .where(eq(column, value))
    .for("update")) as T["$inferSelect"][];
  return row;
}

/** Inserts a row and audits it (before = null, after = the new row). */
export async function insertAudited<T extends TableWithId>(
  tx: Executor,
  table: T,
  values: T["$inferInsert"],
  ctx: AuditContext,
  action: AuditAction = "import",
): Promise<T["$inferSelect"]> {
  const row = await insertRow(tx, table, values);
  await writeAudit(tx, {
    ...ctx,
    tableName: getTableName(table),
    rowId: rowId(row),
    action,
    before: null,
    after: row,
  });
  return row;
}

/** Updates the row with this id (locked first) and audits before and after. */
export async function updateAudited<T extends TableWithId>(
  tx: Executor,
  table: T,
  id: string,
  patch: Partial<T["$inferInsert"]>,
  ctx: AuditContext,
  action: AuditAction = "update",
): Promise<T["$inferSelect"]> {
  const before = await lockRow(tx, table, table.id, id);
  if (!before) throw new Error(`${getTableName(table)} ${id} not found`);
  const after = await updateRow(tx, table, id, patch);
  await writeAudit(tx, {
    ...ctx,
    tableName: getTableName(table),
    rowId: id,
    action,
    before,
    after,
  });
  return after;
}

/** Sets deleted_at and audits it as a soft delete. */
export async function softDeleteAudited<T extends TableWithSoftDelete>(
  tx: Executor,
  table: T,
  id: string,
  ctx: AuditContext,
  at: Date = new Date(),
): Promise<T["$inferSelect"]> {
  const patch = { deletedAt: at } as Partial<T["$inferInsert"]>;
  return updateAudited(tx, table, id, patch, ctx, "soft_delete");
}

/**
 * Inserts or updates the row whose `keyColumn` equals `keyValue`. Inserts are
 * audited as "import", real changes as "update"; when nothing differs nothing
 * is written and the result is "unchanged". Fields left undefined are not
 * compared or changed. Same comparison rules as upsertWithAudit: numeric
 * strings compare by value ("1" = "1.000"), dates by instant, objects as JSON.
 */
export async function upsertAudited<T extends TableWithId>(
  tx: Executor,
  table: T,
  keyColumn: PgColumn,
  keyValue: string,
  values: T["$inferInsert"],
  ctx: AuditContext,
): Promise<{ row: T["$inferSelect"]; result: UpsertResult }> {
  const existing = await lockRow(tx, table, keyColumn, keyValue);
  if (!existing) {
    return { row: await insertAudited(tx, table, values, ctx, "import"), result: "inserted" };
  }
  // Backstop for the handlers' own checks: rows this system created are never
  // changed by an import (only ServiceTitan's own rows are).
  if ((existing as { origin?: unknown }).origin === "new") {
    throw new Error(
      `${getTableName(table)} ${keyValue} was created in this system; an import can't change it.`,
    );
  }
  const patch = changedFields(table, existing, values);
  if (Object.keys(patch).length === 0) return { row: existing, result: "unchanged" };
  const id = rowId(existing);
  const after = await updateRow(tx, table, id, patch as Partial<T["$inferInsert"]>);
  await writeAudit(tx, {
    ...ctx,
    tableName: getTableName(table),
    rowId: id,
    action: "update",
    before: existing,
    after,
  });
  return { row: after, result: "updated" };
}

/** Fields of `values` whose value differs from `existing` (ignoring undefined). */
export function changedFields(
  table: TableWithId,
  existing: object,
  values: object,
): Record<string, unknown> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const current = existing as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const numeric = columns[key]?.columnType === "PgNumeric";
    const same = numeric
      ? normalizeDecimal(current[key]) === normalizeDecimal(value)
      : sameValue(current[key], value);
    if (!same) changed[key] = value;
  }
  return changed;
}

/** "1", "1.0" and "1.000" are the same numeric value. */
function normalizeDecimal(value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const integer = whole.replace(/^(-?)0+(?=\d)/, "$1");
  const text = trimmed ? `${integer}.${trimmed}` : integer;
  return text === "-0" ? "0" : text;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a == null ? a : new Date(String(a)).getTime();
    const tb = b instanceof Date ? b.getTime() : b == null ? b : new Date(String(b)).getTime();
    return ta === tb;
  }
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}
