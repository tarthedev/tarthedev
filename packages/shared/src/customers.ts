import { z } from "zod";
import {
  centsSchema,
  localDateSchema,
  pageQuerySchema,
  pageSchema,
  searchTextSchema,
} from "./common";
import { businessUnitCodeSchema } from "./roles";
import {
  billingStageSchema,
  customerTypeSchema,
  equipmentKindSchema,
  invoiceStatusSchema,
  membershipStatusSchema,
  originSchema,
} from "./values";

/**
 * GET /api/customers?q=&type=&page=&pageSize= (office roles).
 *
 * `q` matches customer and contact names and emails, service and billing
 * addresses (street, city, zip, site name) and phone numbers. Every word must
 * match somewhere. A query that looks like a phone number ("252-555-0123",
 * "5550123") also matches contacts' phones by digits, so caller ID works
 * however it is typed. Without `q`, every customer is listed by name.
 */
export const customerSearchQuerySchema = pageQuerySchema.extend({
  q: searchTextSchema,
  type: customerTypeSchema.optional(),
});
export type CustomerSearchQuery = z.infer<typeof customerSearchQuerySchema>;

export const addressSchema = z.object({
  street: z.string(),
  street2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});
export type Address = z.infer<typeof addressSchema>;

export const customerSummarySchema = z.object({
  id: z.string(),
  /** ServiceTitan customer ID for imported customers. */
  stId: z.string().nullable(),
  type: customerTypeSchema,
  name: z.string(),
  email: z.string().nullable(),
  /** The primary contact's phone (or the first contact's), E.164. */
  phone: z.string().nullable(),
  /** The first service location's address. */
  address: addressSchema.extend({ name: z.string().nullable() }).nullable(),
  locationCount: z.int().min(0),
  /** Has an active membership at any of its locations. */
  member: z.boolean(),
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerListResponseSchema = pageSchema(customerSummarySchema);
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;

export const equipmentSchema = z.object({
  id: z.string(),
  kind: equipmentKindSchema,
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial: z.string().nullable(),
  installYear: z.int().nullable(),
  /** Whole years since `installYear`, as of `asOf`; null when the install year is unknown. */
  ageYears: z.int().min(0).nullable(),
  /** Older than the replacement age setting (docs/01: "older than 15 years"). */
  pastReplacementAge: z.boolean(),
  warrantyEnd: localDateSchema.nullable(),
  notes: z.string().nullable(),
});
export type EquipmentSummary = z.infer<typeof equipmentSchema>;

export const membershipSchema = z.object({
  id: z.string(),
  planName: z.string(),
  status: membershipStatusSchema,
  startDate: localDateSchema,
  /** Renewal date. */
  endDate: localDateSchema,
  visitsRemaining: z.int().min(0),
  autoRenew: z.boolean(),
  priceCents: centsSchema,
});
export type MembershipSummary = z.infer<typeof membershipSchema>;

export const customerLocationSchema = addressSchema.extend({
  id: z.string(),
  stId: z.string().nullable(),
  /** Site name for commercial locations (e.g. "Store #4"). */
  name: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  accessNotes: z.string().nullable(),
  defaultBusinessUnit: z
    .object({ id: z.string(), code: businessUnitCodeSchema, name: z.string() })
    .nullable(),
  /** Any equipment here is past the replacement age (the booking screen's replacement flag). */
  replacementFlag: z.boolean(),
  equipment: z.array(equipmentSchema),
  memberships: z.array(membershipSchema),
});
export type CustomerLocation = z.infer<typeof customerLocationSchema>;

export const customerContactSchema = z.object({
  id: z.string(),
  locationId: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  altPhone: z.string().nullable(),
  email: z.string().nullable(),
  textOptIn: z.boolean(),
  isPrimary: z.boolean(),
});
export type CustomerContact = z.infer<typeof customerContactSchema>;

export const invoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  /** "servicetitan" invoices are imported history: read-only, never posted to QuickBooks. */
  origin: originSchema,
  jobId: z.string().nullable(),
  locationId: z.string().nullable(),
  invoiceDate: localDateSchema,
  dueDate: localDateSchema.nullable(),
  status: invoiceStatusSchema,
  billingStage: billingStageSchema.nullable(),
  totalCents: centsSchema,
  balanceCents: centsSchema,
  summary: z.string().nullable(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

/** GET /api/customers/:id (office roles): the customer's file, as the screen pop shows it. */
export const customerDetailSchema = z.object({
  id: z.string(),
  stId: z.string().nullable(),
  type: customerTypeSchema,
  name: z.string(),
  email: z.string().nullable(),
  /** The bill-to address; null when none is on file. */
  billTo: z
    .object({
      street: z.string().nullable(),
      street2: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      zip: z.string().nullable(),
    })
    .nullable(),
  /** 0 = due on receipt; N = net N days. */
  termsNetDays: z.int().min(0),
  poRequired: z.boolean(),
  taxExempt: z.boolean(),
  notes: z.string().nullable(),
  /** Sum of balances on open invoices. */
  openBalanceCents: centsSchema,
  /** The business-local day ages were computed for. */
  asOf: localDateSchema,
  /** The replacement age setting in effect on `asOf`. */
  replacementAgeYears: z.int().min(1),
  locations: z.array(customerLocationSchema),
  contacts: z.array(customerContactSchema),
  /** The 10 most recent invoices, newest first. */
  recentInvoices: z.array(invoiceSummarySchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/** How many invoices the customer file shows. */
export const RECENT_INVOICE_LIMIT = 10;

/** Starting value of the replacement-flag age setting (docs/01-operations.md, Phones). */
export const DEFAULT_REPLACEMENT_AGE_YEARS = 15;
