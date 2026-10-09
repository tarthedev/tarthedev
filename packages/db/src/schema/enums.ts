/**
 * Allowed values for text columns. Stored as `text` with a CHECK constraint
 * (not Postgres enums) so new values are a one-line migration. Import these
 * lists instead of retyping the strings.
 */

export const ROLES = ["owner", "manager", "dispatcher_csr", "tech", "installer"] as const;
export type Role = (typeof ROLES)[number];

export const SKILLS = ["hvac", "plumbing", "refrigeration", "commercial"] as const;
export type Skill = (typeof SKILLS)[number];

export const BUSINESS_UNIT_CODES = [
  "hvac_service",
  "hvac_replacement",
  "plumbing",
  "commercial",
  "new_construction",
] as const;
export type BusinessUnitCode = (typeof BUSINESS_UNIT_CODES)[number];

export const CUSTOMER_TYPES = ["residential", "commercial"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const EQUIPMENT_KINDS = [
  "furnace",
  "ac",
  "heat_pump",
  "air_handler",
  "mini_split",
  "boiler",
  "water_heater",
  "tankless_water_heater",
  "rooftop_unit",
  "walk_in_cooler",
  "walk_in_freezer",
  "ice_machine",
  "reach_in",
  "other",
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "expired", "canceled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_VISIT_KINDS = ["spring_cooling", "fall_heating"] as const;
export type MembershipVisitKind = (typeof MEMBERSHIP_VISIT_KINDS)[number];

export const PRICEBOOK_KINDS = ["service", "material", "equipment"] as const;
export type PricebookKind = (typeof PRICEBOOK_KINDS)[number];

/** Which system created a row: ServiceTitan (imported, read-only) or this system. */
export const ORIGINS = ["servicetitan", "new"] as const;
export type Origin = (typeof ORIGINS)[number];

export const JOB_STATUSES = ["scheduled", "in_progress", "hold", "done", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["emergency", "today", "scheduled"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "dispatched",
  "on_the_way",
  "working",
  "done",
  "canceled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const ASSIGNED_BY = ["ai", "user", "import"] as const;
export type AssignedBy = (typeof ASSIGNED_BY)[number];

export const OVERRIDE_REASONS = [
  "customer_request",
  "tech_skill",
  "tech_running_behind",
  "traffic_or_distance",
  "part_availability",
  "other",
] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

export const TIME_ENTRY_KINDS = ["shift", "job"] as const;
export type TimeEntryKind = (typeof TIME_ENTRY_KINDS)[number];

export const TIME_ENTRY_SOURCES = ["app", "office", "import"] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

export const LOCATION_STATES = ["live", "paused", "stale", "off"] as const;
export type LocationState = (typeof LOCATION_STATES)[number];

export const GPS_PAUSED_REASONS = ["hidden", "denied", "low_accuracy"] as const;
export type GpsPausedReason = (typeof GPS_PAUSED_REASONS)[number];

export const INVOICE_STATUSES = ["draft", "open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const BILLING_STAGES = ["deposit", "rough_in", "trim_out", "final"] as const;
export type BillingStage = (typeof BILLING_STAGES)[number];

export const PAYMENT_METHODS = [
  "card_link",
  "card_keyed",
  "card_reader",
  "ach",
  "greensky",
  "check",
  "cash",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Refunds and chargebacks are their own rows with a positive amount. */
export const PAYMENT_KINDS = ["payment", "refund", "chargeback"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const JOB_COST_KINDS = [
  "parts",
  "equipment",
  "labor",
  "permit",
  "finance_fee",
  "card_fee",
  "subcontractor",
  "rental",
  "disposal",
] as const;
export type JobCostKind = (typeof JOB_COST_KINDS)[number];

export const JOB_COST_SOURCES = [
  "time_entry",
  "po_line",
  "stock_move",
  "invoice_line",
  "payment",
  "manual",
  "import",
] as const;
export type JobCostSource = (typeof JOB_COST_SOURCES)[number];

export const AUDIT_ACTIONS = [
  "insert",
  "update",
  "delete",
  "soft_delete",
  "restore",
  "import",
  "bulk_load",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const WEBHOOK_PROVIDERS = ["stripe", "twilio", "qbo", "postmark"] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const ST_IMPORT_STATUSES = [
  "uploaded",
  "previewed",
  "importing",
  "imported",
  "failed",
] as const;
export type StImportStatus = (typeof ST_IMPORT_STATUSES)[number];

export const ST_IMPORT_ROW_RESULTS = ["inserted", "updated", "unchanged", "rejected"] as const;
export type StImportRowResult = (typeof ST_IMPORT_ROW_RESULTS)[number];

/** `dollars` totals are stored in integer cents like every other money value. */
export const ST_IMPORT_METRICS = ["count", "dollars"] as const;
export type StImportMetric = (typeof ST_IMPORT_METRICS)[number];

export const SYSTEM_OF_RECORD_SCOPES = ["business_unit", "user"] as const;
export type SystemOfRecordScope = (typeof SYSTEM_OF_RECORD_SCOPES)[number];
