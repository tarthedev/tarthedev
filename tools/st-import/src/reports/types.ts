import type { BusinessUnitCode } from "@dwrg/db";
import type { GroupScope, RowOutcome } from "../context";
import type { Lookups } from "../lookups";
import type { ReportMapping } from "../mappings/types";
import type { RowIssue, RowReader } from "../reader";

/**
 * A record whose details repeat across rows (a customer on each of its
 * location rows, a job on each of its invoice lines). Every mention in one
 * file must carry the same details.
 */
export interface Claim {
  /** "table:ServiceTitan ID". */
  key: string;
  /** "Customer 1234", for messages. */
  label: string;
  details: Record<string, unknown>;
}

export interface ParsedRow<R> {
  rowNumber: number;
  /** Raw cells keyed by header, exactly as read. */
  cells: Readonly<Record<string, string>>;
  /** Mapped cells (trimmed) keyed by field, for the preview. */
  fields: Record<string, string>;
  /** The typed row. Only meaningful when `issues` is empty. */
  value: R;
  issues: RowIssue[];
}

/** Header name for a field: the file's column, or the field's usual name. */
export type ColumnLabel<F extends string> = (field: F) => string;

/** How one report type is read, checked and written. */
export interface ReportHandler<F extends string, R> {
  mapping: ReportMapping<F>;
  /** Reads one row into typed values; problems go to `reader.issues`. */
  parse(reader: RowReader<F>): R;
  /** Fills in what depends on other rows of the file (e.g. line positions in an invoice). */
  finalize?(rows: readonly ParsedRow<R>[]): void;
  /** The row's own ServiceTitan ID (its most specific record). */
  stIdOf(row: R): string | null;
  /** Records the row mentions whose details must agree across the file. */
  claims(row: R): Claim[];
  /** Rows with the same key import together, all or nothing. Null (or no method): the row alone. */
  groupKey?(row: R): string | null;
  /** "invoice 1234", for messages about the rest of a group. */
  groupLabel?(row: R): string;
  /**
   * The order groups import in (default: file order), e.g. a job before the
   * callbacks that refer to it. Results are still reported in file order.
   */
  orderGroups?(groups: readonly ParsedRow<R>[][]): ParsedRow<R>[][];
  /** Checks across one group (adds issues to its rows). */
  checkGroup?(rows: readonly ParsedRow<R>[], column: ColumnLabel<F>): void;
  /** Business units the row needs; import creates missing ones first. */
  businessUnits(row: R): BusinessUnitCode[];
  /** Loads the database rows the file refers to. */
  load(lookups: Lookups, rows: readonly R[]): Promise<void>;
  /** Preview: records the file itself creates and may refer to. */
  defines?(lookups: Lookups, row: R): void;
  /** Reference checks for preview (throws RowError). Import checks the same while writing. */
  check(lookups: Lookups, row: R, column: ColumnLabel<F>): void;
  /** Writes one group of rows (throws RowError, before writing anything, to reject the group). */
  importGroup(
    scope: GroupScope,
    rows: readonly ParsedRow<R>[],
    column: ColumnLabel<F>,
  ): Promise<RowOutcome[]>;
}

/** Keeps a handler's field and row types while checking it against the interface. */
export function defineHandler<F extends string, R>(
  handler: ReportHandler<F, R>,
): ReportHandler<F, R> {
  return handler;
}
