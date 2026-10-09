import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditColumns, localDate, oneOf, pk, timestamptz } from "./columns";
import { AUDIT_ACTIONS, WEBHOOK_PROVIDERS } from "./enums";

/**
 * Effective-dated settings (CLAUDE.md rule 7). A change is a new row; the
 * previous row gets `effective_to`. `effective_from` is inclusive and
 * `effective_to` exclusive, both business-local dates (America/New_York).
 */
export const settings = pgTable(
  "settings",
  {
    id: pk(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    effectiveFrom: localDate("effective_from").notNull(),
    effectiveTo: localDate("effective_to"),
    reason: text("reason"),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("settings_key_effective_from_key").on(t.key, t.effectiveFrom),
    check(
      "settings_effective_range_check",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * Who changed what, when, from what to what, and why (CLAUDE.md rule 4).
 * Append-only: a trigger (migration 0001) rejects UPDATE and DELETE.
 * `row_id` is text because Better Auth user ids are text.
 * `user_id` deliberately has no foreign key so the log outlives anything.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    userId: text("user_id"),
    at: timestamptz("at").notNull().defaultNow(),
    reason: text("reason"),
  },
  (t) => [
    index("audit_log_table_name_row_id_idx").on(t.tableName, t.rowId),
    index("audit_log_at_idx").on(t.at),
    index("audit_log_user_id_idx").on(t.userId),
    check("audit_log_action_check", oneOf(t.action, AUDIT_ACTIONS)),
  ],
);

/** Inbound webhooks, recorded before processing so each event runs exactly once. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: pk(),
    provider: text("provider", { enum: WEBHOOK_PROVIDERS }).notNull(),
    eventId: text("event_id").notNull(),
    type: text("type"),
    payload: jsonb("payload"),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_id_key").on(t.provider, t.eventId),
    index("webhook_events_unprocessed_idx").on(t.receivedAt).where(sql`${t.processedAt} is null`),
    check("webhook_events_provider_check", oneOf(t.provider, WEBHOOK_PROVIDERS)),
  ],
);

/**
 * Numbers for jobs and invoices created in this system (`nextval('job_number_seq')`).
 * Imported rows keep ServiceTitan's numbers; how new numbers are formatted so
 * they never collide with ServiceTitan's is up to the API.
 */
export const jobNumberSeq = pgSequence("job_number_seq", { startWith: 100_001 });
export const invoiceNumberSeq = pgSequence("invoice_number_seq", { startWith: 100_001 });

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
