import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  auditColumns,
  cents,
  localDate,
  oneOf,
  pk,
  softDelete,
  stId,
  timestamptz,
  userRef,
} from "./columns";
import { customers, locations } from "./customers";
import {
  BILLING_STAGES,
  INVOICE_STATUSES,
  JOB_COST_KINDS,
  JOB_COST_SOURCES,
  ORIGINS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
} from "./enums";
import { businessUnits } from "./people";
import { pricebookItems } from "./pricebook";
import { jobs } from "./work";

/**
 * Invoice money, all integer cents:
 * - subtotal_cents = sum of line gross amounts (quantity x unit price, rounded half-up per line)
 * - discount_cents = all discounts, including member pricing
 * - total_cents = subtotal - discount + tax (enforced)
 * - balance_cents = total - payments + refunds
 * The commission "sale" is subtotal - discount (tax excluded).
 * Only the system that created an invoice (`origin`) posts it to QuickBooks.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    stId: stId(),
    origin: text("origin", { enum: ORIGINS }).notNull().default("new"),
    number: text("number").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    locationId: uuid("location_id").references(() => locations.id),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
    invoiceDate: localDate("invoice_date").notNull(),
    dueDate: localDate("due_date"),
    subtotalCents: cents("subtotal_cents").notNull().default(0),
    discountCents: cents("discount_cents").notNull().default(0),
    taxCents: cents("tax_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull().default(0),
    balanceCents: cents("balance_cents").notNull().default(0),
    poNumber: text("po_number"),
    billingStage: text("billing_stage", { enum: BILLING_STAGES }),
    paidInFullAt: timestamptz("paid_in_full_at"),
    qboInvoiceId: text("qbo_invoice_id"),
    summary: text("summary"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("invoices_st_id_key").on(t.stId),
    uniqueIndex("invoices_number_key").on(t.number),
    uniqueIndex("invoices_qbo_invoice_id_key").on(t.qboInvoiceId),
    index("invoices_job_id_idx").on(t.jobId),
    index("invoices_customer_id_idx").on(t.customerId),
    index("invoices_status_idx").on(t.status),
    index("invoices_invoice_date_idx").on(t.invoiceDate),
    index("invoices_business_unit_id_invoice_date_idx").on(t.businessUnitId, t.invoiceDate),
    check("invoices_origin_check", oneOf(t.origin, ORIGINS)),
    check("invoices_origin_st_id_check", sql`${t.origin} = 'new' or ${t.stId} is not null`),
    check("invoices_status_check", oneOf(t.status, INVOICE_STATUSES)),
    check(
      "invoices_billing_stage_check",
      sql`${t.billingStage} is null or ${oneOf(t.billingStage, BILLING_STAGES)}`,
    ),
    check(
      "invoices_total_check",
      sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} + ${t.taxCents}`,
    ),
    check("invoices_discount_check", sql`${t.discountCents} >= 0`),
    check("invoices_tax_check", sql`${t.taxCents} >= 0`),
  ],
);

/**
 * `quantity` is an exact decimal string (numeric(12,3)), never a float.
 * Line money: gross = round_half_up(quantity x unit_price_cents);
 * amount_cents = gross - discount_cents; tax_cents is this line's tax;
 * cost_cents is the extended cost of the line.
 */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: pk(),
    stId: stId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    pricebookItemId: uuid("pricebook_item_id").references(() => pricebookItems.id),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    unitPriceCents: cents("unit_price_cents").notNull(),
    discountCents: cents("discount_cents").notNull().default(0),
    amountCents: cents("amount_cents").notNull(),
    taxable: boolean("taxable").notNull().default(false),
    taxCents: cents("tax_cents").notNull().default(0),
    costCents: cents("cost_cents").notNull().default(0),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("invoice_lines_st_id_key").on(t.stId),
    index("invoice_lines_invoice_id_idx").on(t.invoiceId),
    index("invoice_lines_pricebook_item_id_idx").on(t.pricebookItemId),
    check("invoice_lines_discount_check", sql`${t.discountCents} >= 0`),
    check("invoice_lines_tax_check", sql`${t.taxCents} >= 0`),
  ],
);

/**
 * Money received (or refunded) against an invoice. `amount_cents` is always
 * positive; `kind` says which way it went. Card data never touches our
 * server: only Stripe IDs are stored.
 */
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    stId: stId(),
    origin: text("origin", { enum: ORIGINS }).notNull().default("new"),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    kind: text("kind", { enum: PAYMENT_KINDS }).notNull().default("payment"),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    /** Processor or dealer fee withheld (also recorded as a job cost). */
    feeCents: cents("fee_cents").notNull().default(0),
    receivedAt: timestamptz("received_at").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    checkNumber: text("check_number"),
    reference: text("reference"),
    qboPaymentId: text("qbo_payment_id"),
    recordedByUserId: userRef("recorded_by_user_id"),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("payments_st_id_key").on(t.stId),
    uniqueIndex("payments_stripe_payment_intent_id_key").on(t.stripePaymentIntentId),
    uniqueIndex("payments_qbo_payment_id_key").on(t.qboPaymentId),
    index("payments_invoice_id_idx").on(t.invoiceId),
    index("payments_received_at_idx").on(t.receivedAt),
    check("payments_origin_check", oneOf(t.origin, ORIGINS)),
    check("payments_origin_st_id_check", sql`${t.origin} = 'new' or ${t.stId} is not null`),
    check("payments_kind_check", oneOf(t.kind, PAYMENT_KINDS)),
    check("payments_method_check", oneOf(t.method, PAYMENT_METHODS)),
    check("payments_amount_check", sql`${t.amountCents} > 0`),
    check("payments_fee_check", sql`${t.feeCents} >= 0`),
  ],
);

/**
 * Every cost on a job (gross profit = sale - sum of job costs). Negative
 * amounts are allowed for credits. `source` + `source_id` point at what
 * produced the cost (time entry, PO line, stock move, invoice line, payment).
 */
export const jobCosts = pgTable(
  "job_costs",
  {
    id: pk(),
    stId: stId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    kind: text("kind", { enum: JOB_COST_KINDS }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    source: text("source", { enum: JOB_COST_SOURCES }).notNull(),
    sourceId: text("source_id"),
    description: text("description"),
    incurredAt: timestamptz("incurred_at").notNull(),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("job_costs_st_id_key").on(t.stId),
    index("job_costs_job_id_idx").on(t.jobId),
    index("job_costs_source_idx").on(t.source, t.sourceId),
    check("job_costs_kind_check", oneOf(t.kind, JOB_COST_KINDS)),
    check("job_costs_source_check", oneOf(t.source, JOB_COST_SOURCES)),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type JobCost = typeof jobCosts.$inferSelect;
export type NewJobCost = typeof jobCosts.$inferInsert;
