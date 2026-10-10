import { createHash } from "node:crypto";
import {
  type Database,
  type Executor,
  stImportBatches,
  stImportRows,
  stImportTotals,
  user,
} from "@dwrg/db";
import {
  fieldErrorsFrom,
  IMPORT_ISSUE_LIMIT,
  IMPORT_PREVIEW_ROW_LIMIT,
  type ImportBatch,
  type ImportBatchDetail,
  type ImportListResponse,
  type ImportPreviewResponse,
  type ImportTotal,
  type ImportUploadOptions,
  idParamSchema,
  importListQuerySchema,
  importSummaryRequestSchema,
  importUploadOptionsSchema,
  isStReportType,
  MAX_IMPORT_FILE_BYTES,
  OFFICE_ROLES,
} from "@dwrg/shared";
import {
  compareWithSummary,
  preview,
  runImport,
  StImportError,
  StImportFailedError,
  TOTALS_MEANING,
} from "@dwrg/st-import";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthedEnv } from "../context";
import { ApiError, conflict, notFound, validationFailed } from "../errors";
import { serializeError } from "../logger";
import { requireRole } from "../middleware/session";
import { validate } from "../middleware/validate";

/**
 * ServiceTitan report-export imports (docs/06-servicetitan-migration.md),
 * for office roles (owner, manager, dispatcher/CSR):
 *
 * - POST /api/imports/preview      upload a CSV: detect, map and check it; writes nothing
 * - POST /api/imports              import it with @dwrg/st-import; returns the import report
 * - GET  /api/imports              past uploads, newest first
 * - GET  /api/imports/:id          one upload's import report
 * - POST /api/imports/:id/summary  enter ServiceTitan's summary totals to compare
 *
 * An upload is multipart/form-data (a `file` field, plus `reportType` and,
 * for the import, the `sha256` the preview showed) or the CSV itself as a
 * text/csv or text/plain body with those options in the query string. Files
 * are capped at MAX_IMPORT_FILE_BYTES; Excel workbooks are refused with a
 * plea to export CSV. Imports are idempotent on ServiceTitan IDs, audited by
 * the importer with the signed-in person as the actor, and never write
 * anything back to ServiceTitan.
 */

/** Room for multipart boundaries and the small form fields next to the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Paths with their own (larger) body limit; app.ts skips the 1 MB JSON limit for them. */
export const IMPORT_UPLOAD_PATHS: readonly string[] = ["/api/imports", "/api/imports/preview"];

export function isImportUpload(method: string, path: string): boolean {
  return method === "POST" && IMPORT_UPLOAD_PATHS.includes(path);
}

/**
 * Where uploaded files are kept unchanged (docs/06: "Raw files kept"). The
 * DigitalOcean Spaces store arrives with photos and PDFs (month 4). Until one
 * is passed to createApp, an upload is kept as its raw rows in st_import_rows
 * (every cell exactly as read) with its sha256, and its storage key starts
 * with ROWS_ONLY_STORAGE_PREFIX so no one goes looking for a file that was
 * never stored.
 */
export interface ImportFileStore {
  /** Saves `bytes` under `key`. The key is derived from the sha256, so a repeat is harmless. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export const ROWS_ONLY_STORAGE_PREFIX = "rows-only:";

export function storageKeyFor(sha256: string, stored: boolean): string {
  return stored
    ? `st-imports/${sha256}.csv`
    : `${ROWS_ONLY_STORAGE_PREFIX}st-imports/${sha256}.csv`;
}

export interface ImportRouteDeps {
  db: Database;
  fileStore?: ImportFileStore;
}

export function importRoutes({ db, fileStore }: ImportRouteDeps) {
  const uploadLimit = bodyLimit({
    maxSize: MAX_IMPORT_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
    onError: () => {
      throw tooLarge();
    },
  });

  return (
    new Hono<AuthedEnv>()
      // Every import endpoint is for the office. Checked before any body is read.
      .use("*", requireRole(...OFFICE_ROLES))
      .get("/", validate("query", importListQuerySchema), async (c) => {
        const { page, pageSize, reportType } = c.req.valid("query");
        const where = reportType ? eq(stImportBatches.reportType, reportType) : undefined;
        const [items, [total]] = await Promise.all([
          selectBatches(db, where)
            .orderBy(desc(stImportBatches.uploadedAt), desc(stImportBatches.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          db.select({ n: count() }).from(stImportBatches).where(where),
        ]);
        const body: ImportListResponse = {
          items: items.map(toBatch),
          page,
          pageSize,
          total: total?.n ?? 0,
        };
        return c.json(body);
      })
      .post("/preview", uploadLimit, async (c) => {
        const upload = await readUpload(c);
        const result = await preview({
          db,
          csvText: upload.text,
          reportType: upload.options.reportType,
          limit: IMPORT_PREVIEW_ROW_LIMIT,
        });
        const body: ImportPreviewResponse = {
          file: { name: upload.name, sizeBytes: upload.bytes.byteLength, sha256: upload.sha256 },
          reportType: result.reportType,
          detectedReportType: result.detection.reportType,
          detectionNote: result.detection.reason ?? null,
          candidates: result.detection.candidates.map((candidate) => ({
            reportType: candidate.reportType,
            label: candidate.label,
            missingRequired: candidate.missingRequired,
            matchedHeaders: candidate.matchedHeaders,
            scoreBps: candidate.scoreBps,
          })),
          headers: result.headers,
          headerRowNumber: result.headerRowNumber,
          columns: result.columns,
          missingColumns: result.missingColumns,
          unmatchedHeaders: result.unmatchedHeaders,
          fileError: result.fileError,
          rowCount: result.rowCount,
          rows: result.rows.map((row) => ({
            rowNumber: row.rowNumber,
            stId: row.stId,
            fields: row.fields,
          })),
          errors: result.errors.slice(0, IMPORT_ISSUE_LIMIT),
          errorCount: result.errors.length,
          rejectedRows: result.rejectedRows,
        };
        c.get("log").info("import previewed", {
          reportType: result.reportType,
          rows: result.rowCount,
          rejectedRows: result.rejectedRows,
          fileError: result.fileError !== null,
          sizeBytes: upload.bytes.byteLength,
        });
        return c.json(body);
      })
      .post("/", uploadLimit, async (c) => {
        const upload = await readUpload(c);
        if (upload.options.sha256 && upload.options.sha256 !== upload.sha256) {
          throw conflict("This file isn't the one you previewed. Preview it again, then import.", {
            file: ["Changed since the preview"],
          });
        }
        const user = c.get("user");
        const log = c.get("log");

        const stored = fileStore !== undefined;
        const storageKey = storageKeyFor(upload.sha256, stored);
        if (fileStore) await fileStore.put(storageKey, upload.bytes, "text/csv");

        const started = performance.now();
        let batchId: string;
        try {
          const result = await runImport({
            db,
            csvText: upload.text,
            reportType: upload.options.reportType,
            fileName: upload.name,
            uploadedBy: user.id,
            storageKey,
          });
          batchId = result.batchId;
          log.info("import finished", {
            batchId,
            reportType: result.reportType,
            status: result.status,
            rowsRead: result.rowsRead,
            inserted: result.inserted,
            updated: result.updated,
            unchanged: result.unchanged,
            rejected: result.rejected,
            durationMs: Math.round(performance.now() - started),
          });
        } catch (error) {
          if (error instanceof StImportFailedError) {
            log.error("import failed", { batchId: error.batchId, err: serializeError(error) });
            throw new ApiError(
              500,
              "internal",
              "The import stopped on our side and nothing was imported. Try again, or tell the office.",
            );
          }
          throw error;
        }
        const detail = await readBatchDetail(db, batchId);
        if (!detail) throw new Error(`import batch ${batchId} vanished`);
        return c.json(detail, 201);
      })
      .get("/:id", validate("param", idParamSchema), async (c) => {
        const detail = await readBatchDetail(db, c.req.valid("param").id);
        if (!detail) throw notFound("No import with that id.");
        return c.json(detail);
      })
      .post(
        "/:id/summary",
        validate("param", idParamSchema),
        validate("json", importSummaryRequestSchema),
        async (c) => {
          const { id } = c.req.valid("param");
          const { rows } = c.req.valid("json");
          const [batch] = await db
            .select({ status: stImportBatches.status })
            .from(stImportBatches)
            .where(eq(stImportBatches.id, id));
          if (!batch) throw notFound("No import with that id.");
          if (batch.status !== "imported") {
            throw conflict("Only a finished import has totals to compare.");
          }
          try {
            await compareWithSummary({ db, batchId: id, summary: rows });
          } catch (error) {
            if (error instanceof StImportError) {
              throw validationFailed({ rows: [error.message] }, error.message);
            }
            throw error;
          }
          const detail = await readBatchDetail(db, id);
          if (!detail) throw notFound("No import with that id.");
          c.get("log").info("import summary entered", {
            batchId: id,
            lines: rows.length,
            matches: detail.summary.matches,
          });
          return c.json(detail);
        },
      )
  );
}

const tooLarge = () =>
  new ApiError(
    413,
    "payload_too_large",
    `The file is too large. The limit is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB; export a shorter date range.`,
  );

interface Upload {
  name: string;
  bytes: Uint8Array;
  /** The CSV text, as the importer reads it. */
  text: string;
  /** sha256 of the bytes exactly as uploaded. */
  sha256: string;
  options: ImportUploadOptions;
}

const MULTIPART = /^multipart\/form-data/i;
const CSV_TEXT = /^(text\/csv|text\/plain|application\/csv)(\s*;.*)?$/i;

/** Reads the uploaded file and its options from a multipart or text body. */
async function readUpload(c: Context<AuthedEnv>): Promise<Upload> {
  const type = c.req.header("Content-Type") ?? "";
  let bytes: Uint8Array;
  let uploadedName: string | undefined;
  const raw: Record<string, string> = {};

  if (MULTIPART.test(type)) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "validation_failed", "The upload couldn't be read. Try again.");
    }
    let file: File | undefined;
    for (const [key, value] of form.entries()) {
      if (key === "file") {
        if (typeof value === "string" || file) {
          throw validationFailed({ file: ["Choose one CSV file"] }, "Choose one CSV file.");
        }
        file = value;
      } else if (typeof value !== "string") {
        throw validationFailed({ [key]: [UNKNOWN_FILE_FIELD] });
      } else if (key in raw) {
        throw validationFailed({ [key]: ["Send this only once"] });
      } else {
        raw[key] = value;
      }
    }
    if (!file) throw validationFailed({ file: ["Choose a CSV file"] }, "Choose a CSV file.");
    if (file.size > MAX_IMPORT_FILE_BYTES) throw tooLarge();
    uploadedName = file.name;
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (CSV_TEXT.test(type)) {
    Object.assign(raw, c.req.query());
    bytes = new Uint8Array(await c.req.arrayBuffer());
  } else {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Upload the file as multipart/form-data, or send the CSV itself as text/csv.",
    );
  }

  // Blank options (an empty "Detect" choice) count as left out.
  const options = importUploadOptionsSchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, value]) => value.trim() !== "")),
  );
  if (!options.success) throw validationFailed(fieldErrorsFrom(options.error));

  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) throw tooLarge();
  if (bytes.byteLength === 0) {
    throw validationFailed({ file: ["The file is empty"] }, "The file is empty.");
  }
  if (isZip(bytes)) {
    const message = "This is an Excel workbook. In ServiceTitan, export the report as CSV.";
    throw validationFailed({ file: [message] }, message);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name =
    options.data.fileName ??
    (uploadedName ? cleanFileName(uploadedName) : undefined) ??
    `servicetitan-export-${sha256.slice(0, 8)}.csv`;
  return { name, bytes, text: decodeCsv(bytes), sha256, options: options.data };
}

const UNKNOWN_FILE_FIELD = "Only the `file` field can be a file";

function cleanFileName(name: string): string | undefined {
  const parsed = importUploadOptionsSchema.shape.fileName.safeParse(name);
  return parsed.success ? parsed.data : undefined;
}

/** .xlsx files are zip archives ("PK\x03\x04"). */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * The CSV as text. UTF-8 (with or without a byte-order mark, which is kept
 * for the CSV reader to skip, so the importer's sha256 of the text matches
 * the file's); UTF-16 when it starts with a UTF-16 byte-order mark; anything
 * else that isn't valid UTF-8 is read as Windows-1252, the encoding Excel
 * uses when it saves "CSV" on Windows.
 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function selectBatches(db: Executor, where: SQL | undefined) {
  return db
    .select({
      id: stImportBatches.id,
      reportType: stImportBatches.reportType,
      fileName: stImportBatches.fileName,
      fileSha256: stImportBatches.fileSha256,
      storageKey: stImportBatches.storageKey,
      uploadedById: stImportBatches.uploadedBy,
      uploadedByName: user.name,
      uploadedAt: stImportBatches.uploadedAt,
      status: stImportBatches.status,
      rowsRead: stImportBatches.rowsRead,
      inserted: stImportBatches.rowsInserted,
      updated: stImportBatches.rowsUpdated,
      unchanged: stImportBatches.rowsUnchanged,
      rejected: stImportBatches.rowsRejected,
      error: stImportBatches.error,
      completedAt: stImportBatches.completedAt,
    })
    .from(stImportBatches)
    .leftJoin(user, eq(user.id, stImportBatches.uploadedBy))
    .where(where);
}

type BatchRow = Awaited<ReturnType<typeof selectBatches>>[number];

function toBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    reportType: isStReportType(row.reportType) ? row.reportType : null,
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    storageKey: row.storageKey,
    uploadedBy:
      row.uploadedById === null
        ? null
        : { id: row.uploadedById, name: row.uploadedByName ?? "Former user" },
    uploadedAt: row.uploadedAt.toISOString(),
    status: row.status,
    rowsRead: row.rowsRead,
    inserted: row.inserted,
    updated: row.updated,
    unchanged: row.unchanged,
    rejected: row.rejected,
    error: row.error,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function totalStatus(summary: number | null, diff: number | null): ImportTotal["status"] {
  if (summary === null) return "not_in_summary";
  return diff === 0 ? "match" : "differs";
}

/** The import report for one batch, or null when there is no such batch. */
export async function readBatchDetail(
  db: Executor,
  batchId: string,
): Promise<ImportBatchDetail | null> {
  const [row] = await selectBatches(db, eq(stImportBatches.id, batchId));
  if (!row) return null;
  const batch = toBatch(row);

  const rejectedWhere = and(eq(stImportRows.batchId, batchId), eq(stImportRows.result, "rejected"));
  const [totalRows, rejectedRows, [rejectedCount]] = await Promise.all([
    db
      .select()
      .from(stImportTotals)
      .where(eq(stImportTotals.batchId, batchId))
      .orderBy(
        asc(stImportTotals.businessUnitCode),
        asc(stImportTotals.year),
        asc(stImportTotals.metric),
      ),
    db
      .select({ rowNumber: stImportRows.rowNumber, error: stImportRows.error })
      .from(stImportRows)
      .where(rejectedWhere)
      .orderBy(asc(stImportRows.rowNumber))
      .limit(IMPORT_ISSUE_LIMIT),
    db.select({ n: count() }).from(stImportRows).where(rejectedWhere),
  ]);

  const totals: ImportTotal[] = totalRows.map((t) => ({
    businessUnitCode: t.businessUnitCode,
    year: t.year,
    metric: t.metric,
    ours: t.ours,
    servicetitanSummary: t.servicetitanSummary,
    diff: t.diff,
    note: t.note,
    status: totalStatus(t.servicetitanSummary, t.diff),
  }));
  const entered = totals.some((t) => t.servicetitanSummary !== null);
  const meaning = batch.reportType ? TOTALS_MEANING[batch.reportType] : null;
  return {
    ...batch,
    totalsMeaning: meaning ? { count: meaning.count, dollars: meaning.dollars ?? null } : null,
    totals,
    summary: {
      entered,
      // The same rule as @dwrg/st-import compareWithSummary.
      matches:
        entered &&
        totals.every(
          (t) => t.status === "match" || (t.status === "not_in_summary" && t.ours === 0),
        ),
    },
    errors: rejectedRows.map((r) => ({
      rowNumber: r.rowNumber,
      column: null,
      message: r.error ?? "Rejected.",
    })),
    errorCount: rejectedCount?.n ?? 0,
  };
}
