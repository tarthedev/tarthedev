import { createHash } from "node:crypto";
import {
  type Executor,
  type StImportRowResult,
  stImportBatches,
  stImportRows,
  user,
} from "@dwrg/db";
import { eq, sql } from "drizzle-orm";
import { GroupScope, type ImportContext, type RowOutcome } from "./context";
import { CsvParseError, type CsvRecord, type ParsedCsv, parseCsv } from "./csv";
import {
  describeDatabaseError,
  isRowLevelDatabaseError,
  RowError,
  StImportError,
  StImportFailedError,
} from "./errors";
import { type ColumnMatch, type DetectResult, detectReportType, matchColumns } from "./headers";
import { Lookups } from "./lookups";
import type { ReportType } from "./mappings/types";
import { RowReader } from "./reader";
import { withHandler } from "./reports";
import type { ColumnLabel, ParsedRow, ReportHandler } from "./reports/types";
import { computeTotalsIn, type TotalRow } from "./totals";

/** One problem, on one row, in words for the Import page. */
export interface ImportIssue {
  /** Spreadsheet row number (the header is row 1 when it is the first line). */
  rowNumber: number;
  column: string | null;
  message: string;
}

export interface PreviewRow {
  rowNumber: number;
  /** The row's own ServiceTitan ID. */
  stId: string | null;
  /** Mapped cells by field name (trimmed text, as in the file). */
  fields: Record<string, string>;
  /** Typed values (money in cents, dates as YYYY-MM-DD); null when the row has problems. */
  values: unknown;
}

export interface PreviewResult {
  reportType: ReportType | null;
  detection: DetectResult;
  headers: string[];
  headerRowNumber: number | null;
  /** Field -> the file column it is read from. */
  columns: Record<string, string>;
  missingColumns: string[];
  /** File columns no field uses (kept in the raw rows, otherwise ignored). */
  unmatchedHeaders: string[];
  /** A problem with the whole file; when set, nothing can be imported. */
  fileError: string | null;
  rowCount: number;
  /** The first rows, mapped. */
  rows: PreviewRow[];
  /** Every problem in the file, by row. */
  errors: ImportIssue[];
  /** How many rows would be rejected. */
  rejectedRows: number;
}

export interface PreviewOptions {
  db: Executor;
  csvText: string;
  /** Leave out to detect it from the headers. */
  reportType?: ReportType;
  /** How many mapped rows to return (default 20). */
  limit?: number;
}

export interface RunImportOptions {
  db: Executor;
  csvText: string;
  /** Leave out to detect it from the headers. */
  reportType?: ReportType;
  fileName: string;
  /** The person importing (a `user` id); null for the worker. */
  uploadedBy: string | null;
  /**
   * Where the caller stored the uploaded file unchanged (object storage key).
   * Defaults to `st-imports/<sha256>.csv`; the caller stores the bytes there.
   */
  storageKey?: string;
}

export interface ImportCounts {
  rowsRead: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export interface ImportResult extends ImportCounts {
  batchId: string;
  reportType: ReportType | null;
  status: "imported" | "failed";
  /** Why the whole file failed (wrong columns, unreadable CSV). */
  error: string | null;
  fileSha256: string;
  storageKey: string;
  /** One message per rejected row. */
  errors: ImportIssue[];
  /** The import report: our counts and dollar totals per business unit and year. */
  totals: TotalRow[];
}

/** Rows parsed and checked, grouped the way they import. */
interface Analysis<R> {
  rows: ParsedRow<R>[];
  groups: ParsedRow<R>[][];
}

function analyze<F extends string, R>(
  handler: ReportHandler<F, R>,
  match: ColumnMatch<F>,
  csv: ParsedCsv,
): Analysis<R> {
  const column: ColumnLabel<F> = (field) =>
    match.columns[field] ?? handler.mapping.fields[field].headers[0] ?? field;
  const rows = csv.records.map((record) => parseRow(handler, match, csv, record));
  handler.finalize?.(rows);

  // Every mention of a record must carry the same details.
  const firstMention = new Map<string, { rowNumber: number; details: Record<string, unknown> }>();
  for (const row of rows) {
    if (row.issues.length > 0) continue;
    for (const claim of handler.claims(row.value)) {
      const seen = firstMention.get(claim.key);
      if (!seen) {
        firstMention.set(claim.key, { rowNumber: row.rowNumber, details: claim.details });
        continue;
      }
      const differing = differingKeys(seen.details, claim.details);
      if (differing.length > 0) {
        row.issues.push({
          column: null,
          message: `${claim.label} is also on row ${seen.rowNumber} with different details (${differing.join(", ")}).`,
        });
      }
    }
  }

  const byKey = new Map<string, ParsedRow<R>[]>();
  const groups: ParsedRow<R>[][] = [];
  for (const row of rows) {
    const key = handler.groupKey?.(row.value) ?? null;
    if (key === null) {
      groups.push([row]);
      continue;
    }
    const group = byKey.get(key);
    if (group) group.push(row);
    else {
      const created = [row];
      byKey.set(key, created);
      groups.push(created);
    }
  }
  for (const group of groups) {
    if (handler.checkGroup && group.every((row) => row.issues.length === 0)) {
      handler.checkGroup(group, column);
    }
  }
  return { rows, groups };
}

function parseRow<F extends string, R>(
  handler: ReportHandler<F, R>,
  match: ColumnMatch<F>,
  csv: ParsedCsv,
  record: CsvRecord,
): ParsedRow<R> {
  const reader = new RowReader(handler.mapping, match.columns, record.cells);
  if (record.cellCount > csv.headers.length) {
    reader.fail(
      null,
      `This row has ${record.cellCount} cells but the header row has ${csv.headers.length}.`,
    );
  }
  const value = handler.parse(reader);
  const fields: Record<string, string> = {};
  for (const field of Object.keys(match.columns) as F[]) {
    fields[field] = reader.cell(field) ?? "";
  }
  return { rowNumber: record.rowNumber, cells: record.cells, fields, value, issues: reader.issues };
}

/** The details that differ, in words ("totalCents" -> "total", "customerStId" -> "customer"). */
function differingKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) =>
      key
        .replace(/(Cents|StId)$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase(),
    );
}

/** Messages for a group with problems: the rows' own, and why their siblings are held back. */
function groupProblems<F extends string, R>(
  handler: ReportHandler<F, R>,
  group: readonly ParsedRow<R>[],
): Map<number, ImportIssue[]> | null {
  const bad = group.find((row) => row.issues.length > 0);
  if (!bad) return null;
  const label = handler.groupLabel?.(bad.value) ?? "its group";
  const problems = new Map<number, ImportIssue[]>();
  for (const row of group) {
    problems.set(
      row.rowNumber,
      row.issues.length > 0
        ? row.issues.map((issue) => ({ rowNumber: row.rowNumber, ...issue }))
        : [
            {
              rowNumber: row.rowNumber,
              column: null,
              message: `Not imported because row ${bad.rowNumber} of ${label} has a problem.`,
            },
          ],
    );
  }
  return problems;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface FileCheck {
  csv: ParsedCsv | null;
  detection: DetectResult | null;
  reportType: ReportType | null;
  fileError: string | null;
}

function checkFile(csvText: string, reportType: ReportType | undefined): FileCheck {
  let csv: ParsedCsv;
  try {
    csv = parseCsv(csvText);
  } catch (error) {
    if (error instanceof CsvParseError) {
      return {
        csv: null,
        detection: null,
        reportType: reportType ?? null,
        fileError: error.message,
      };
    }
    throw error;
  }
  const detection = detectReportType(csv.headers);
  const type = reportType ?? detection.reportType;
  if (!type) {
    return { csv, detection, reportType: null, fileError: detection.reason ?? "Unknown report." };
  }
  const missing = withHandler(type, (h) => matchColumns(h.mapping, csv.headers).missingRequired);
  if (missing.length > 0) {
    return {
      csv,
      detection,
      reportType: type,
      fileError: `The file has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}, which the ${type} report needs.`,
    };
  }
  return { csv, detection, reportType: type, fileError: null };
}

/**
 * Reads an export without writing anything: the report type (given or
 * detected), how columns map, the first rows mapped, and every problem with
 * its row number, including references to records not imported yet.
 */
export async function preview(options: PreviewOptions): Promise<PreviewResult> {
  const check = checkFile(options.csvText, options.reportType);
  const csv = check.csv;
  const base: PreviewResult = {
    reportType: check.reportType,
    detection: check.detection ?? { reportType: null, candidates: [] },
    headers: csv?.headers ?? [],
    headerRowNumber: csv?.headerRowNumber ?? null,
    columns: {},
    missingColumns: [],
    unmatchedHeaders: [],
    fileError: check.fileError,
    rowCount: csv?.records.length ?? 0,
    rows: [],
    errors: [],
    rejectedRows: 0,
  };
  if (!csv || !check.reportType) return base;
  const reportType = check.reportType;

  return withHandler(reportType, (handler) =>
    previewRows(handler, options, csv, base, check.fileError !== null),
  );
}

async function previewRows<F extends string, R>(
  handler: ReportHandler<F, R>,
  options: PreviewOptions,
  csv: ParsedCsv,
  base: PreviewResult,
  fileError: boolean,
): Promise<PreviewResult> {
  const match = matchColumns(handler.mapping, csv.headers);
  const result: PreviewResult = {
    ...base,
    columns: Object.fromEntries(
      Object.entries(match.columns).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    missingColumns: match.missingRequired,
    unmatchedHeaders: match.unmatchedHeaders,
  };
  if (fileError) return result;

  const column: ColumnLabel<F> = (field) =>
    match.columns[field] ?? handler.mapping.fields[field].headers[0] ?? field;
  const { rows, groups } = analyze(handler, match, csv);
  const lookups = new Lookups(options.db, "preview");
  const clean = rows.filter((row) => row.issues.length === 0).map((row) => row.value);
  await handler.load(lookups, clean);
  await lookups.loadBusinessUnits();
  for (const value of clean) handler.defines?.(lookups, value);
  for (const group of groups) {
    if (group.some((row) => row.issues.length > 0)) continue;
    for (const row of group) {
      try {
        handler.check(lookups, row.value, column);
      } catch (error) {
        if (!(error instanceof RowError)) throw error;
        row.issues.push({ column: error.column ?? null, message: error.message });
      }
    }
  }

  const errors: ImportIssue[] = [];
  let rejected = 0;
  for (const group of groups) {
    const problems = groupProblems(handler, group);
    if (!problems) continue;
    for (const issues of problems.values()) {
      rejected++;
      errors.push(...issues);
    }
  }
  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  result.errors = errors;
  result.rejectedRows = rejected;
  result.rows = rows.slice(0, options.limit ?? 20).map((row) => ({
    rowNumber: row.rowNumber,
    stId: handler.stIdOf(row.value),
    fields: row.fields,
    values: row.issues.length === 0 ? row.value : null,
  }));
  return result;
}

const RAW_ROW_CHUNK = 1_000;
const BATCH_LOCK = "dwrg.st_import";

async function insertRawRows(tx: Executor, batchId: string, records: readonly CsvRecord[]) {
  for (let i = 0; i < records.length; i += RAW_ROW_CHUNK) {
    const chunk = records.slice(i, i + RAW_ROW_CHUNK);
    await tx.insert(stImportRows).values(
      chunk.map((record) => ({
        batchId,
        rowNumber: record.rowNumber,
        payload: record.cells,
      })),
    );
  }
}

async function writeOutcomes(tx: Executor, batchId: string, outcomes: readonly RowOutcome[]) {
  for (let i = 0; i < outcomes.length; i += RAW_ROW_CHUNK) {
    const chunk = outcomes.slice(i, i + RAW_ROW_CHUNK);
    const values = sql.join(
      chunk.map(
        (o) =>
          sql`(${o.rowNumber}::int, ${o.result}::text, ${o.stId}::text, ${o.targetTable}::text, ${o.targetId}::text, ${o.error}::text)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update ${stImportRows} as r
      set result = v.result, st_id = v.st_id, target_table = v.target_table,
          target_id = v.target_id, error = v.error
      from (values ${values}) as v(row_number, result, st_id, target_table, target_id, error)
      where r.batch_id = ${batchId} and r.row_number = v.row_number
    `);
  }
}

function countOutcomes(rowsRead: number, outcomes: readonly RowOutcome[]): ImportCounts {
  const count = (result: StImportRowResult) => outcomes.filter((o) => o.result === result).length;
  return {
    rowsRead,
    inserted: count("inserted"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    rejected: count("rejected"),
  };
}

async function assertUploader(db: Executor, uploadedBy: string | null): Promise<void> {
  if (uploadedBy === null) return;
  const [found] = await db
    .select({ id: user.id, active: user.active })
    .from(user)
    .where(eq(user.id, uploadedBy));
  if (!found?.active) {
    throw new StImportError(`uploadedBy ${uploadedBy} is not an active user.`);
  }
}

/** Records an upload that could not be imported, keeping its raw rows. */
async function recordFailedBatch(
  db: Executor,
  batch: {
    reportType: ReportType | null;
    fileName: string;
    storageKey: string;
    fileSha256: string;
    uploadedBy: string | null;
    error: string;
    records: readonly CsvRecord[];
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(stImportBatches)
      .values({
        reportType: batch.reportType ?? "unknown",
        fileName: batch.fileName,
        storageKey: batch.storageKey,
        fileSha256: batch.fileSha256,
        uploadedBy: batch.uploadedBy,
        status: "failed",
        rowsRead: batch.records.length,
        error: batch.error,
        completedAt: new Date(),
      })
      .returning({ id: stImportBatches.id });
    if (!row) throw new Error("Could not record the failed import batch.");
    await insertRawRows(tx, row.id, batch.records);
    return row.id;
  });
}

/**
 * Imports one ServiceTitan report export in one transaction:
 *
 * 1. records the batch (who, when, file name, storage key, sha256) and every
 *    raw row exactly as read in st_import_rows;
 * 2. checks every row (values, references, totals, numbers already taken)
 *    and rejects bad rows, or the whole invoice they belong to, with readable
 *    errors, without stopping the batch;
 * 3. upserts our rows keyed on ServiceTitan IDs (st_id), with an audit_log
 *    row for every insert and real change, so re-importing the same file
 *    changes nothing and reports every row unchanged;
 * 4. records each row's result and computes the import report totals
 *    (st_import_totals).
 *
 * Nothing is ever sent to ServiceTitan. A file with the wrong columns, or
 * data the database refuses that the checks didn't catch, rolls back, is
 * recorded as a failed batch (raw rows kept) and comes back with status
 * "failed" and the reason. Any other error (an outage, a bug) rolls back,
 * records a failed batch when it can and throws StImportFailedError.
 */
export async function runImport(options: RunImportOptions): Promise<ImportResult> {
  const { db, csvText, fileName, uploadedBy } = options;
  const fileSha256 = sha256(csvText);
  const storageKey = options.storageKey ?? `st-imports/${fileSha256}.csv`;
  await assertUploader(db, uploadedBy);

  const check = checkFile(csvText, options.reportType);
  const records = check.csv?.records ?? [];
  const failedResult = async (error: string): Promise<ImportResult> => {
    const batchId = await recordFailedBatch(db, {
      reportType: check.reportType,
      fileName,
      storageKey,
      fileSha256,
      uploadedBy,
      error,
      records,
    });
    return {
      batchId,
      reportType: check.reportType,
      status: "failed",
      error,
      fileSha256,
      storageKey,
      rowsRead: records.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      errors: [],
      totals: [],
    };
  };
  if (check.fileError || !check.csv || !check.reportType) {
    return failedResult(check.fileError ?? "The file could not be read.");
  }
  const csv = check.csv;
  const reportType = check.reportType;

  try {
    return await db.transaction((tx) =>
      withHandler(reportType, (handler) =>
        importRows(handler, {
          tx,
          csv,
          reportType,
          fileName,
          uploadedBy,
          storageKey,
          fileSha256,
        }),
      ),
    );
  } catch (error) {
    // Nothing was imported: the transaction rolled back. Keep a record of the upload.
    const cause = error instanceof GroupFailure ? error.cause : error;
    const where = error instanceof GroupFailure ? ` at row ${error.rowNumber}` : "";
    if (isRowLevelDatabaseError(cause)) {
      // Data the checks didn't catch (e.g. two items swapping codes): a failed
      // batch with a readable reason, not an outage.
      return failedResult(
        `The import stopped${where}: ${describeDatabaseError(cause)} Nothing was imported.`,
      );
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    let batchId: string | null = null;
    try {
      batchId = await recordFailedBatch(db, {
        reportType,
        fileName,
        storageKey,
        fileSha256,
        uploadedBy,
        error: `The import stopped${where} by an unexpected error; nothing was imported. ${message}`,
        records,
      });
    } catch {
      // The database itself is failing; the caller still gets the original error.
    }
    throw new StImportFailedError(
      `The ${reportType} import stopped${where} by an unexpected error; nothing was imported. ${message}`,
      batchId,
      { cause },
    );
  }
}

/** An error while a group was writing; the import stops and rolls back. */
class GroupFailure extends Error {
  constructor(
    readonly rowNumber: number,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

interface ImportRun {
  tx: Executor;
  csv: ParsedCsv;
  reportType: ReportType;
  fileName: string;
  uploadedBy: string | null;
  storageKey: string;
  fileSha256: string;
}

/** The body of runImport, inside its transaction. */
async function importRows<F extends string, R>(
  handler: ReportHandler<F, R>,
  run: ImportRun,
): Promise<ImportResult> {
  const { tx, csv, reportType, fileName, uploadedBy } = run;
  const records = csv.records;
  // One import at a time, so two uploads never race on the same records.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${BATCH_LOCK}))`);
  const [batch] = await tx
    .insert(stImportBatches)
    .values({
      reportType,
      fileName,
      storageKey: run.storageKey,
      fileSha256: run.fileSha256,
      uploadedBy,
      status: "importing",
      rowsRead: records.length,
    })
    .returning({ id: stImportBatches.id, uploadedAt: stImportBatches.uploadedAt });
  if (!batch) throw new Error("Could not record the import batch.");
  await insertRawRows(tx, batch.id, records);

  const match = matchColumns(handler.mapping, csv.headers);
  const column: ColumnLabel<F> = (field) =>
    match.columns[field] ?? handler.mapping.fields[field].headers[0] ?? field;
  const { rows, groups } = analyze(handler, match, csv);
  const lookups = new Lookups(tx, "import");
  const clean = rows.filter((row) => row.issues.length === 0).map((row) => row.value);
  await handler.load(lookups, clean);
  const ctx: ImportContext = {
    tx,
    lookups,
    audit: {
      userId: uploadedBy,
      reason: `ServiceTitan ${reportType} import ${fileName} (batch ${batch.id})`,
    },
    startedAt: batch.uploadedAt,
    written: new Map(),
  };
  const codes = clean.flatMap((value) => handler.businessUnits(value));
  if (codes.length > 0) {
    await lookups.loadBusinessUnits();
    await lookups.ensureBusinessUnits(codes, ctx.audit);
  }

  const outcomes: RowOutcome[] = [];
  const reject = (row: ParsedRow<R>, message: string) =>
    outcomes.push({
      rowNumber: row.rowNumber,
      result: "rejected",
      stId: handler.stIdOf(row.value) || null,
      targetTable: null,
      targetId: null,
      error: message,
    });
  for (const group of handler.orderGroups?.(groups) ?? groups) {
    const problems = groupProblems(handler, group);
    if (problems) {
      for (const row of group) {
        reject(row, (problems.get(row.rowNumber) ?? []).map((p) => p.message).join(" "));
      }
      continue;
    }
    const firstRow = group[0]?.rowNumber ?? 0;
    const scope = new GroupScope(ctx, {
      userId: uploadedBy,
      reason: `${ctx.audit.reason} row ${firstRow}`,
    });
    try {
      const done = await handler.importGroup(scope, group, column);
      scope.commit();
      outcomes.push(...done);
    } catch (error) {
      // A group is rejected only before it writes anything; past that point
      // (or on any other error) the whole import stops and rolls back.
      if (!(error instanceof RowError) || scope.wrote) throw new GroupFailure(firstRow, error);
      const blamed = error.rowNumber;
      const label = group[0] ? handler.groupLabel?.(group[0].value) : undefined;
      for (const row of group) {
        reject(
          row,
          blamed === undefined || blamed === row.rowNumber || !label
            ? error.message
            : `Not imported because row ${blamed} of ${label} has a problem: ${error.message}`,
        );
      }
    }
  }
  outcomes.sort((a, b) => a.rowNumber - b.rowNumber);
  await writeOutcomes(tx, batch.id, outcomes);
  const counts = countOutcomes(records.length, outcomes);
  await tx
    .update(stImportBatches)
    .set({
      status: "imported",
      rowsInserted: counts.inserted,
      rowsUpdated: counts.updated,
      rowsUnchanged: counts.unchanged,
      rowsRejected: counts.rejected,
      completedAt: new Date(),
    })
    .where(eq(stImportBatches.id, batch.id));
  const totals = await computeTotalsIn(tx, batch.id, reportType);
  return {
    batchId: batch.id,
    reportType,
    status: "imported",
    error: null,
    fileSha256: run.fileSha256,
    storageKey: run.storageKey,
    ...counts,
    errors: outcomes
      .filter((o) => o.result === "rejected")
      .map((o) => ({ rowNumber: o.rowNumber, column: null, message: o.error ?? "" })),
    totals,
  };
}
