import type {
  AuditContext,
  Executor,
  StImportRowResult,
  TableWithId,
  TableWithSoftDelete,
  UpsertResult,
} from "@dwrg/db";
import { getTableName } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Lookups } from "./lookups";
import { insertAudited, softDeleteAudited, updateAudited, upsertAudited } from "./write";

/** A row this batch wrote, and what writing it did. */
export interface Written {
  id: string;
  result: UpsertResult;
}

/** Shared state of one import run. */
export interface ImportContext {
  /** The import transaction. */
  tx: Executor;
  lookups: Lookups;
  /** Who imported and the base audit reason ("ServiceTitan import ... (batch ...)"). */
  audit: { userId: string | null; reason: string };
  /** When the import started (used for deactivations with no date in the file). */
  startedAt: Date;
  /** "table:key" -> id and result of every row written by finished groups of this batch. */
  written: Map<string, Written>;
}

/**
 * One group of rows (usually one row; all rows of one invoice) being
 * imported. Handlers resolve every reference first (throwing RowError to
 * reject the group) and only then write, through these methods, so a
 * rejected group has written nothing. There are no savepoints (see
 * write.ts): once a group has written, any error stops the whole import and
 * the transaction rolls back. What the group learns (new ids) reaches the
 * shared context only when it finishes.
 */
export class GroupScope {
  private readonly written = new Map<string, Written>();
  private readonly onFinish: (() => void)[] = [];
  private writes = 0;

  constructor(
    readonly ctx: ImportContext,
    readonly audit: AuditContext,
  ) {}

  get tx(): Executor {
    return this.ctx.tx;
  }

  get lookups(): Lookups {
    return this.ctx.lookups;
  }

  /** True once the group has inserted, updated or deleted anything. */
  get wrote(): boolean {
    return this.writes > 0;
  }

  /** Runs `fn` once the group has finished. */
  onCommit(fn: () => void): void {
    this.onFinish.push(fn);
  }

  commit(): void {
    for (const [key, written] of this.written) this.ctx.written.set(key, written);
    for (const fn of this.onFinish) fn();
  }

  /** A row this batch already wrote, if any. */
  writtenRow(table: TableWithId, key: string): Written | undefined {
    const memo = `${getTableName(table)}:${key}`;
    return this.written.get(memo) ?? this.ctx.written.get(memo);
  }

  /**
   * Inserts or updates the row keyed on `keyColumn` = `key`, with an audit
   * row for every real change (action "import" for inserts). A row this batch
   * already wrote is not written again (the file was checked up front, so
   * every mention of it has the same details); each later mention reports
   * what the first write did, so every row carrying a change shows it.
   */
  async upsert<T extends TableWithId>(
    table: T,
    keyColumn: PgColumn,
    key: string,
    values: T["$inferInsert"],
  ): Promise<Written> {
    const already = this.writtenRow(table, key);
    if (already) return already;
    const { row, result } = await upsertAudited(this.tx, table, keyColumn, key, values, this.audit);
    if (result !== "unchanged") this.writes++;
    const written = { id: String((row as { id: unknown }).id), result };
    this.written.set(`${getTableName(table)}:${key}`, written);
    return written;
  }

  async insert<T extends TableWithId>(
    table: T,
    values: T["$inferInsert"],
  ): Promise<T["$inferSelect"]> {
    this.writes++;
    return insertAudited(this.tx, table, values, this.audit, "import");
  }

  async update<T extends TableWithId>(
    table: T,
    id: string,
    patch: Partial<T["$inferInsert"]>,
    reason?: string,
  ): Promise<T["$inferSelect"]> {
    this.writes++;
    return updateAudited(this.tx, table, id, patch, this.withReason(reason));
  }

  async softDelete<T extends TableWithSoftDelete>(
    table: T,
    id: string,
    reason?: string,
  ): Promise<T["$inferSelect"]> {
    this.writes++;
    return softDeleteAudited(this.tx, table, id, this.withReason(reason));
  }

  private withReason(extra: string | undefined): AuditContext {
    return extra ? { ...this.audit, reason: `${this.audit.reason ?? ""}; ${extra}` } : this.audit;
  }
}

/** What happened to one CSV row. */
export interface RowOutcome {
  rowNumber: number;
  result: StImportRowResult;
  /** The row's own ServiceTitan ID (its most specific record). */
  stId: string | null;
  /** The table and id of the row's most specific record. */
  targetTable: string | null;
  targetId: string | null;
  error: string | null;
}

/**
 * A row's result: "inserted" when its own record is new; otherwise "updated"
 * when anything it carries changed; otherwise "unchanged".
 */
export function rowResult(
  primary: UpsertResult,
  others: readonly (UpsertResult | null | undefined)[] = [],
): StImportRowResult {
  if (primary === "inserted") return "inserted";
  if (primary === "updated" || others.some((r) => r === "inserted" || r === "updated")) {
    return "updated";
  }
  return "unchanged";
}
