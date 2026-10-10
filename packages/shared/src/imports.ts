import { z } from "zod";
import { instantSchema, oneOfSchema, pageQuerySchema, pageSchema } from "./common";

/**
 * ServiceTitan report-export imports (docs/06-servicetitan-migration.md), for
 * the office Import page (owner, manager, dispatcher/CSR):
 *
 * - POST /api/imports/preview  upload a CSV; detect, map and check it (writes nothing)
 * - POST /api/imports          import it (idempotent on ServiceTitan IDs); returns the import report
 * - GET  /api/imports          past uploads, newest first
 * - GET  /api/imports/:id      one upload's import report
 * - POST /api/imports/:id/summary  enter ServiceTitan's own summary totals to compare
 *
 * Uploads are multipart/form-data (a `file` field plus the options below as
 * fields) or the CSV itself as a text/csv or text/plain body (options in the
 * query string). Money is integer cents; ServiceTitan is never written to.
 */

/** Report types, in the order a full import runs them (mirrors @dwrg/st-import REPORT_TYPES). */
export const ST_REPORT_TYPES = [
  "technicians",
  "pricebook",
  "customers",
  "equipment",
  "memberships",
  "invoices",
  "payments",
  "timesheets",
] as const;
export type StReportType = (typeof ST_REPORT_TYPES)[number];
export const stReportTypeSchema = oneOfSchema(ST_REPORT_TYPES);

export function isStReportType(value: unknown): value is StReportType {
  return typeof value === "string" && (ST_REPORT_TYPES as readonly string[]).includes(value);
}

/** Names on the Import page (the same as the importer's mapping labels). */
export const ST_REPORT_LABELS: Record<StReportType, string> = {
  technicians: "Technicians and business units",
  pricebook: "Pricebook",
  customers: "Customers and locations (with contacts)",
  equipment: "Installed equipment",
  memberships: "Memberships",
  invoices: "Jobs and invoices with line items (and costs)",
  payments: "Payments",
  timesheets: "Timesheets",
};

/** Mirrors @dwrg/db ST_IMPORT_STATUSES. */
export const ST_IMPORT_STATUSES = [
  "uploaded",
  "previewed",
  "importing",
  "imported",
  "failed",
] as const;
export type StImportStatus = (typeof ST_IMPORT_STATUSES)[number];
export const stImportStatusSchema = oneOfSchema(ST_IMPORT_STATUSES);

/** Mirrors @dwrg/db ST_IMPORT_METRICS. `dollars` values are integer cents. */
export const ST_IMPORT_METRICS = ["count", "dollars"] as const;
export type StImportMetric = (typeof ST_IMPORT_METRICS)[number];

/** The largest export the API takes, in bytes. Bigger files: export a shorter date range. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

/** How many mapped rows a preview shows. */
export const IMPORT_PREVIEW_ROW_LIMIT = 20;

/** How many row problems a response lists; `errorCount` is always the full number. */
export const IMPORT_ISSUE_LIMIT = 500;

/** The business unit code of reports that aren't split by business unit. */
export const IMPORT_NO_BUSINESS_UNIT = "none";

/** The year of reports that aren't split by year. */
export const IMPORT_ALL_YEARS = 0;

export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { error: "Must be a SHA-256 digest (64 lower-case hex characters)" });

/**
 * A file name as shown in the import history: the last path segment, without
 * control characters, at most 200 characters.
 */
export const importFileNameSchema = z
  .string()
  .transform((name) =>
    (name.split(/[\\/]/).pop() ?? "")
      .replace(/\p{Cc}/gu, "")
      .trim()
      .slice(0, 200),
  )
  .pipe(z.string().min(1, { error: "Enter a file name" }));

/**
 * Options for POST /api/imports/preview and POST /api/imports: form fields
 * next to `file`, or query parameters with a text body. Blank values count
 * as left out.
 */
export const importUploadOptionsSchema = z.strictObject({
  /** Leave out to detect the report type from the columns. */
  reportType: stReportTypeSchema.optional(),
  /** For a text body (a multipart upload carries its own file name). */
  fileName: importFileNameSchema.optional(),
  /**
   * POST /api/imports only: the sha256 the preview showed. When given, the
   * import is refused (409) if the file is not the one that was previewed.
   */
  sha256: sha256Schema.optional(),
});
export type ImportUploadOptions = z.infer<typeof importUploadOptionsSchema>;

/** One problem on one row, in words. Row numbers are spreadsheet row numbers. */
export const importIssueSchema = z.object({
  rowNumber: z.int().min(0),
  /** The file column the problem is in, when it is one column. */
  column: z.string().nullable(),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importFileSchema = z.object({
  name: z.string(),
  sizeBytes: z.int().min(0),
  sha256: sha256Schema,
});
export type ImportFile = z.infer<typeof importFileSchema>;

export const importCandidateSchema = z.object({
  reportType: stReportTypeSchema,
  label: z.string(),
  /** Required columns the file lacks for this report type. */
  missingRequired: z.array(z.string()),
  /** How many of the file's columns this report type uses. */
  matchedHeaders: z.int().min(0),
  /** matchedHeaders / all columns, in basis points (10000 = every column understood). */
  scoreBps: z.int().min(0).max(10_000),
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;

export const importPreviewRowSchema = z.object({
  rowNumber: z.int().min(0),
  /** The row's own ServiceTitan ID. */
  stId: z.string().nullable(),
  /** Mapped cells by field name, as text from the file. */
  fields: z.record(z.string(), z.string()),
});
export type ImportPreviewRow = z.infer<typeof importPreviewRowSchema>;

/** POST /api/imports/preview: what an import of this file would do. Nothing is written. */
export const importPreviewResponseSchema = z.object({
  file: importFileSchema,
  /** The report type the file will import as (the one asked for, or the detected one). */
  reportType: stReportTypeSchema.nullable(),
  /** The type detected from the columns; null when none or two fit. */
  detectedReportType: stReportTypeSchema.nullable(),
  /** Why nothing was detected, in words. */
  detectionNote: z.string().nullable(),
  /** Every report type, best fit first. */
  candidates: z.array(importCandidateSchema),
  headers: z.array(z.string()),
  headerRowNumber: z.int().nullable(),
  /** Field -> the file column it is read from. */
  columns: z.record(z.string(), z.string()),
  missingColumns: z.array(z.string()),
  /** File columns no field uses (kept in the raw rows, otherwise ignored). */
  unmatchedHeaders: z.array(z.string()),
  /** A problem with the whole file; when set, nothing can be imported. */
  fileError: z.string().nullable(),
  /** Data rows in the file. */
  rowCount: z.int().min(0),
  /** The first rows, mapped. */
  rows: z.array(importPreviewRowSchema),
  /** Row problems, by row (at most IMPORT_ISSUE_LIMIT). */
  errors: z.array(importIssueSchema),
  /** All row problems, including any not listed. */
  errorCount: z.int().min(0),
  /** Rows that would be rejected. */
  rejectedRows: z.int().min(0),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const IMPORT_TOTAL_STATUSES = ["match", "differs", "not_in_summary"] as const;
export type ImportTotalStatus = (typeof IMPORT_TOTAL_STATUSES)[number];

/** One line of the import report: our count or dollars next to ServiceTitan's summary. */
export const importTotalSchema = z.object({
  /** Our business unit code, or "none" for reports without one. */
  businessUnitCode: z.string(),
  /** Calendar year, or 0 for reports not split by year. */
  year: z.int().min(0),
  metric: oneOfSchema(ST_IMPORT_METRICS),
  /** Our count, or our dollars in integer cents. */
  ours: z.int(),
  /** ServiceTitan's figure, once entered. */
  servicetitanSummary: z.int().nullable(),
  /** ours - servicetitanSummary. */
  diff: z.int().nullable(),
  note: z.string().nullable(),
  status: z.enum(IMPORT_TOTAL_STATUSES),
});
export type ImportTotal = z.infer<typeof importTotalSchema>;

/** One upload, as the import history lists it. */
export const importBatchSchema = z.object({
  id: z.string(),
  /** null when the file's report type could not be told. */
  reportType: stReportTypeSchema.nullable(),
  fileName: z.string(),
  fileSha256: z.string().nullable(),
  /** Where the raw file is kept. */
  storageKey: z.string(),
  uploadedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  uploadedAt: instantSchema,
  status: stImportStatusSchema,
  rowsRead: z.int().min(0),
  inserted: z.int().min(0),
  updated: z.int().min(0),
  unchanged: z.int().min(0),
  rejected: z.int().min(0),
  /** Why the whole file failed. */
  error: z.string().nullable(),
  completedAt: instantSchema.nullable(),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

/** GET /api/imports?reportType=&page=&pageSize= */
export const importListQuerySchema = pageQuerySchema.extend({
  reportType: stReportTypeSchema.optional(),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

export const importListResponseSchema = pageSchema(importBatchSchema);
export type ImportListResponse = z.infer<typeof importListResponseSchema>;

/**
 * GET /api/imports/:id, and the answer to POST /api/imports and
 * POST /api/imports/:id/summary: the import report.
 */
export const importBatchDetailSchema = importBatchSchema.extend({
  /** What the report's counts and dollars measure. */
  totalsMeaning: z.object({ count: z.string(), dollars: z.string().nullable() }).nullable(),
  totals: z.array(importTotalSchema),
  /** Whether ServiceTitan's summary has been entered, and whether every line matches it. */
  summary: z.object({ entered: z.boolean(), matches: z.boolean() }),
  /** Rejected rows and why (at most IMPORT_ISSUE_LIMIT). */
  errors: z.array(importIssueSchema),
  /** All rejected rows, including any not listed. */
  errorCount: z.int().min(0),
});
export type ImportBatchDetail = z.infer<typeof importBatchDetailSchema>;

/**
 * One line of ServiceTitan's own summary report, as it shows it. Dollars are
 * text exactly as shown ("$12,345.67"); the server reads them into cents.
 */
export const importSummaryRowSchema = z.strictObject({
  /** ServiceTitan business unit name, or our code; leave out for reports without one. */
  businessUnit: z.string().trim().max(100).nullish(),
  /** Leave out for reports not split by year. */
  year: z.int().min(0).max(9999).nullish(),
  count: z.int().min(0).nullish(),
  /** Dollar total as ServiceTitan shows it, e.g. "$12,345.67". */
  total: z.string().trim().max(32).nullish(),
});
export type ImportSummaryRow = z.infer<typeof importSummaryRowSchema>;

/** POST /api/imports/:id/summary. Replaces any summary entered before. */
export const importSummaryRequestSchema = z.strictObject({
  rows: z
    .array(importSummaryRowSchema)
    .min(1, { error: "Enter at least one line" })
    .max(500, { error: "At most 500 lines" }),
});
export type ImportSummaryRequest = z.infer<typeof importSummaryRequestSchema>;
