import { eq, getTableColumns, getTableName } from "drizzle-orm";
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Executor, Transaction } from "./client";
import { type AuditAction, auditLog } from "./schema";

/**
 * Audit helpers (CLAUDE.md rule 4): every money or pay change writes who,
 * when, before, after and why to `audit_log` in the same transaction as the
 * change. Each helper opens a transaction (a savepoint when it is handed an
 * open transaction), so the change and its audit row commit or roll back
 * together.
 */

export interface AuditContext {
  /** The acting user; null for system jobs, imports and the seed. */
  userId: string | null;
  /** Why the change was made. Required by policy for money and pay edits. */
  reason?: string | null;
}

export interface AuditEntry extends AuditContext {
  tableName: string;
  rowId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  at?: Date;
}

/** A table with a single `id` primary key column. */
export type TableWithId = PgTable & { id: PgColumn };
export type TableWithSoftDelete = TableWithId & { deletedAt: PgColumn };

export type UpsertResult = "inserted" | "updated" | "unchanged";

/** Appends one row to `audit_log`. Use inside the transaction that made the change. */
export async function writeAudit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    tableName: entry.tableName,
    rowId: entry.rowId,
    action: entry.action,
    before: toJson(entry.before),
    after: toJson(entry.after),
    userId: entry.userId,
    reason: entry.reason ?? null,
    ...(entry.at ? { at: entry.at } : {}),
  });
}

/** Inserts a row and audits it (before = null, after = the new row). */
export async function insertWithAudit<T extends TableWithId>(
  executor: Executor,
  table: T,
  values: T["$inferInsert"],
  ctx: AuditContext,
  action: AuditAction = "insert",
): Promise<T["$inferSelect"]> {
  return executor.transaction(async (tx) => {
    const row = await insertRow(tx, table, values);
    await writeAudit(tx, {
      ...ctx,
      tableName: getTableName(table),
      rowId: rowIdOf(row),
      action,
      before: null,
      after: row,
    });
    return row;
  });
}

/**
 * Updates the row with this id and audits before/after. The row is locked
 * (SELECT ... FOR UPDATE) so `before` is exactly what was replaced.
 * Throws if the row does not exist.
 */
export async function updateWithAudit<T extends TableWithId>(
  executor: Executor,
  table: T,
  id: string,
  patch: Partial<T["$inferInsert"]>,
  ctx: AuditContext,
  action: AuditAction = "update",
): Promise<T["$inferSelect"]> {
  return executor.transaction(async (tx) => {
    const before = await lockRow(tx, table, id);
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
  });
}

/** Sets `deleted_at` on a business row and audits it. Rows are never hard-deleted. */
export async function softDeleteWithAudit<T extends TableWithSoftDelete>(
  executor: Executor,
  table: T,
  id: string,
  ctx: AuditContext,
  at: Date = new Date(),
): Promise<T["$inferSelect"]> {
  const patch = { deletedAt: at } as Partial<T["$inferInsert"]>;
  return updateWithAudit(executor, table, id, patch, ctx, "soft_delete");
}

/**
 * Inserts or updates the row whose `keyColumn` (e.g. `st_id`) equals
 * `keyValue`. Writes an audit row for inserts and real changes; when nothing
 * differs it writes nothing and reports "unchanged". This is what idempotent
 * imports use.
 */
export async function upsertWithAudit<T extends TableWithId>(
  executor: Executor,
  table: T,
  keyColumn: PgColumn,
  keyValue: string,
  values: T["$inferInsert"],
  ctx: AuditContext,
  insertAction: AuditAction = "insert",
): Promise<{ row: T["$inferSelect"]; result: UpsertResult }> {
  return executor.transaction(async (tx) => {
    const [existing] = (await tx
      .select()
      .from(table as PgTable)
      .where(eq(keyColumn, keyValue))
      .for("update")) as T["$inferSelect"][];
    if (!existing) {
      const row = await insertRow(tx, table, values);
      await writeAudit(tx, {
        ...ctx,
        tableName: getTableName(table),
        rowId: rowIdOf(row),
        action: insertAction,
        before: null,
        after: row,
      });
      return { row, result: "inserted" as const };
    }
    const patch = changedFields(table, existing, values);
    if (Object.keys(patch).length === 0) return { row: existing, result: "unchanged" as const };
    const id = rowIdOf(existing);
    const after = await updateRow(tx, table, id, patch as Partial<T["$inferInsert"]>);
    await writeAudit(tx, {
      ...ctx,
      tableName: getTableName(table),
      rowId: id,
      action: "update",
      before: existing,
      after,
    });
    return { row: after, result: "updated" as const };
  });
}

async function insertRow<T extends TableWithId>(
  tx: Transaction,
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
  tx: Transaction,
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
  tx: Transaction,
  table: T,
  id: string,
): Promise<T["$inferSelect"] | undefined> {
  const [row] = (await tx
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .for("update")) as T["$inferSelect"][];
  return row;
}

function rowIdOf(row: unknown): string {
  const id = (row as { id?: unknown }).id;
  if (id === undefined || id === null) throw new Error("row has no id");
  return String(id);
}

/** Fields of `values` whose value differs from `existing` (ignoring undefined). */
function changedFields(
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
  return trimmed ? `${integer}.${trimmed}` : integer;
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

/** Rows go into jsonb as plain JSON (Dates become ISO strings). */
function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value));
}
