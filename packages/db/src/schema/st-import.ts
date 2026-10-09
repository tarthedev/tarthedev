import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, oneOf, pk, timestamptz, userRef } from "./columns";
import {
  ORIGINS,
  ST_IMPORT_METRICS,
  ST_IMPORT_ROW_RESULTS,
  ST_IMPORT_STATUSES,
  SYSTEM_OF_RECORD_SCOPES,
} from "./enums";
import { businessUnits } from "./people";

/** One uploaded ServiceTitan report export (docs/06). The raw file is kept unchanged. */
export const stImportBatches = pgTable(
  "st_import_batches",
  {
    id: pk(),
    reportType: text("report_type").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    fileSha256: text("file_sha256"),
    uploadedBy: userRef("uploaded_by"),
    uploadedAt: timestamptz("uploaded_at").notNull().defaultNow(),
    status: text("status", { enum: ST_IMPORT_STATUSES }).notNull().default("uploaded"),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsInserted: integer("rows_inserted").notNull().default(0),
    rowsUpdated: integer("rows_updated").notNull().default(0),
    rowsUnchanged: integer("rows_unchanged").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    error: text("error"),
    completedAt: timestamptz("completed_at"),
    ...auditColumns(),
  },
  (t) => [
    index("st_import_batches_report_type_idx").on(t.reportType, t.uploadedAt),
    check("st_import_batches_status_check", oneOf(t.status, ST_IMPORT_STATUSES)),
  ],
);

/** Raw rows of a batch, exactly as read. Only the processing result is filled in later. */
export const stImportRows = pgTable(
  "st_import_rows",
  {
    id: pk(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => stImportBatches.id),
    rowNumber: integer("row_number").notNull(),
    stId: text("st_id"),
    payload: jsonb("payload").notNull(),
    result: text("result", { enum: ST_IMPORT_ROW_RESULTS }),
    targetTable: text("target_table"),
    targetId: text("target_id"),
    error: text("error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("st_import_rows_batch_id_row_number_key").on(t.batchId, t.rowNumber),
    index("st_import_rows_st_id_idx").on(t.stId),
    check(
      "st_import_rows_result_check",
      sql`${t.result} is null or ${oneOf(t.result, ST_IMPORT_ROW_RESULTS)}`,
    ),
  ],
);

/**
 * The import report: our totals next to ServiceTitan's own summary per
 * business unit and year. Totals are bigint (`dollars` in integer cents).
 */
export const stImportTotals = pgTable(
  "st_import_totals",
  {
    id: pk(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => stImportBatches.id),
    businessUnitCode: text("business_unit_code").notNull(),
    year: integer("year").notNull(),
    metric: text("metric", { enum: ST_IMPORT_METRICS }).notNull(),
    ours: bigint("ours", { mode: "number" }).notNull(),
    servicetitanSummary: bigint("servicetitan_summary", { mode: "number" }),
    diff: bigint("diff", { mode: "number" }),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("st_import_totals_batch_key").on(t.batchId, t.businessUnitCode, t.year, t.metric),
    check("st_import_totals_metric_check", oneOf(t.metric, ST_IMPORT_METRICS)),
  ],
);

/**
 * Which system owns a crew's jobs, invoices and payments (CLAUDE.md rule 13).
 * A `user` row (a pilot crew member) overrides their `business_unit` row.
 * With no row, ServiceTitan owns the work: nothing moves until it is set here.
 * Changes go through the audit helpers.
 */
export const systemOfRecord = pgTable(
  "system_of_record",
  {
    id: pk(),
    scope: text("scope", { enum: SYSTEM_OF_RECORD_SCOPES }).notNull(),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id),
    userId: userRef("user_id"),
    /** Crew label, e.g. "pilot". */
    crew: text("crew"),
    owner: text("owner", { enum: ORIGINS }).notNull(),
    switchedAt: timestamptz("switched_at"),
    notes: text("notes"),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("system_of_record_business_unit_key")
      .on(t.businessUnitId)
      .where(sql`${t.scope} = 'business_unit'`),
    uniqueIndex("system_of_record_user_key").on(t.userId).where(sql`${t.scope} = 'user'`),
    check("system_of_record_scope_check", oneOf(t.scope, SYSTEM_OF_RECORD_SCOPES)),
    check("system_of_record_owner_check", oneOf(t.owner, ORIGINS)),
    check(
      "system_of_record_target_check",
      sql`(${t.scope} = 'business_unit' and ${t.businessUnitId} is not null and ${t.userId} is null) or (${t.scope} = 'user' and ${t.userId} is not null and ${t.businessUnitId} is null)`,
    ),
  ],
);

export type StImportBatch = typeof stImportBatches.$inferSelect;
export type NewStImportBatch = typeof stImportBatches.$inferInsert;
export type StImportRow = typeof stImportRows.$inferSelect;
export type NewStImportRow = typeof stImportRows.$inferInsert;
export type StImportTotal = typeof stImportTotals.$inferSelect;
export type NewStImportTotal = typeof stImportTotals.$inferInsert;
export type SystemOfRecord = typeof systemOfRecord.$inferSelect;
export type NewSystemOfRecord = typeof systemOfRecord.$inferInsert;
