import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { auditColumns, oneOf, pk, softDelete, stId, timestamptz, userRef } from "./columns";
import { customers, locations } from "./customers";
import {
  APPOINTMENT_STATUSES,
  ASSIGNED_BY,
  JOB_PRIORITIES,
  JOB_STATUSES,
  ORIGINS,
  OVERRIDE_REASONS,
  TIME_ENTRY_KINDS,
  TIME_ENTRY_SOURCES,
} from "./enums";
import { businessUnits } from "./people";

/**
 * A job lives in exactly one system (`origin`): imported ServiceTitan jobs are
 * read-only history; `system_of_record` decides where new jobs are created.
 * `finished_at` is when the job became Done (it decides the pay week).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    stId: stId(),
    origin: text("origin", { enum: ORIGINS }).notNull().default("new"),
    /** Job number shown to people; ServiceTitan's job number for imported jobs. */
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    businessUnitId: uuid("business_unit_id")
      .notNull()
      .references(() => businessUnits.id),
    /** e.g. no_heat, no_cooling, leak, water_heater, drain, tune_up, estimate, install, other. */
    jobType: text("job_type").notNull(),
    summary: text("summary"),
    priority: text("priority", { enum: JOB_PRIORITIES }).notNull().default("scheduled"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("scheduled"),
    /** phone, web, referral, membership, builder, import, ... */
    source: text("source"),
    bookedByUserId: userRef("booked_by_user_id"),
    bookedAt: timestamptz("booked_at"),
    poNumber: text("po_number"),
    finishedAt: timestamptz("finished_at"),
    /** Replacement installs: the tech credited with the sale (from the accepted estimate). */
    soldByUserId: userRef("sold_by_user_id"),
    /** Owner/manager-sold replacements: the tech who turned over the lead. */
    leadSourceUserId: userRef("lead_source_user_id"),
    callbackOfJobId: uuid("callback_of_job_id").references((): AnyPgColumn => jobs.id),
    callbackTechCaused: boolean("callback_tech_caused"),
    callbackReason: text("callback_reason"),
    aiTags: jsonb("ai_tags"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("jobs_st_id_key").on(t.stId),
    uniqueIndex("jobs_number_key").on(t.number),
    index("jobs_customer_id_idx").on(t.customerId),
    index("jobs_location_id_idx").on(t.locationId),
    index("jobs_business_unit_id_idx").on(t.businessUnitId),
    index("jobs_status_idx").on(t.status),
    index("jobs_finished_at_idx").on(t.finishedAt),
    index("jobs_booked_at_idx").on(t.bookedAt),
    index("jobs_booked_by_user_id_idx").on(t.bookedByUserId),
    index("jobs_sold_by_user_id_idx").on(t.soldByUserId),
    index("jobs_callback_of_job_id_idx").on(t.callbackOfJobId),
    check("jobs_origin_check", oneOf(t.origin, ORIGINS)),
    check("jobs_origin_st_id_check", sql`${t.origin} = 'new' or ${t.stId} is not null`),
    check("jobs_priority_check", oneOf(t.priority, JOB_PRIORITIES)),
    check("jobs_status_check", oneOf(t.status, JOB_STATUSES)),
    check("jobs_done_finished_check", sql`${t.status} <> 'done' or ${t.finishedAt} is not null`),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: pk(),
    stId: stId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    windowStart: timestamptz("window_start").notNull(),
    windowEnd: timestamptz("window_end").notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull().default("scheduled"),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("appointments_st_id_key").on(t.stId),
    index("appointments_job_id_idx").on(t.jobId),
    index("appointments_window_start_idx").on(t.windowStart),
    check("appointments_status_check", oneOf(t.status, APPOINTMENT_STATUSES)),
    check("appointments_window_check", sql`${t.windowEnd} > ${t.windowStart}`),
  ],
);

/**
 * Who is on an appointment. A reassignment sets `removed_at` on the old row
 * and adds a new one, so the history of AI picks and overrides is kept.
 */
export const assignments = pgTable(
  "assignments",
  {
    id: pk(),
    stId: stId(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    assignedBy: text("assigned_by", { enum: ASSIGNED_BY }).notNull(),
    assignedByUserId: userRef("assigned_by_user_id"),
    aiScore: doublePrecision("ai_score"),
    /** Plain-English reasons shown on the board, e.g. ["Closest qualified tech, 12 minutes away."]. */
    aiReasons: jsonb("ai_reasons").$type<string[]>(),
    overrideReason: text("override_reason", { enum: OVERRIDE_REASONS }),
    overrideNote: text("override_note"),
    removedAt: timestamptz("removed_at"),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("assignments_st_id_key").on(t.stId),
    uniqueIndex("assignments_active_key")
      .on(t.appointmentId, t.userId)
      .where(sql`${t.removedAt} is null`),
    index("assignments_user_id_idx").on(t.userId),
    check("assignments_assigned_by_check", oneOf(t.assignedBy, ASSIGNED_BY)),
    check(
      "assignments_override_reason_check",
      sql`${t.overrideReason} is null or ${oneOf(t.overrideReason, OVERRIDE_REASONS)}`,
    ),
  ],
);

/**
 * Clocked time. `shift` rows are clock in/out for the day; `job` rows run from
 * On My Way (`started_at`) to Done (`ended_at`) and are the labor on a job.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: pk(),
    stId: stId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind", { enum: TIME_ENTRY_KINDS }).notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at"),
    source: text("source", { enum: TIME_ENTRY_SOURCES }).notNull().default("app"),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("time_entries_st_id_key").on(t.stId),
    index("time_entries_user_id_started_at_idx").on(t.userId, t.startedAt),
    index("time_entries_job_id_idx").on(t.jobId),
    check("time_entries_kind_check", oneOf(t.kind, TIME_ENTRY_KINDS)),
    check("time_entries_source_check", oneOf(t.source, TIME_ENTRY_SOURCES)),
    check("time_entries_job_check", sql`${t.kind} <> 'job' or ${t.jobId} is not null`),
    check("time_entries_range_check", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
