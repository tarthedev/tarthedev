import { oneOfSchema } from "./common";

/**
 * Allowed values the browser needs, mirrored from @dwrg/db (where they are
 * CHECK constraints). The API's tests assert each list matches the database's.
 */

export const CUSTOMER_TYPES = ["residential", "commercial"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const customerTypeSchema = oneOfSchema(CUSTOMER_TYPES);

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
export const equipmentKindSchema = oneOfSchema(EQUIPMENT_KINDS);

export const MEMBERSHIP_STATUSES = ["pending", "active", "expired", "canceled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const membershipStatusSchema = oneOfSchema(MEMBERSHIP_STATUSES);

export const PRICEBOOK_KINDS = ["service", "material", "equipment"] as const;
export type PricebookKind = (typeof PRICEBOOK_KINDS)[number];
export const pricebookKindSchema = oneOfSchema(PRICEBOOK_KINDS);

/** Which system created a row: ServiceTitan (imported, read-only) or this one. */
export const ORIGINS = ["servicetitan", "new"] as const;
export type Origin = (typeof ORIGINS)[number];
export const originSchema = oneOfSchema(ORIGINS);

export const INVOICE_STATUSES = ["draft", "open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const invoiceStatusSchema = oneOfSchema(INVOICE_STATUSES);

export const BILLING_STAGES = ["deposit", "rough_in", "trim_out", "final"] as const;
export type BillingStage = (typeof BILLING_STAGES)[number];
export const billingStageSchema = oneOfSchema(BILLING_STAGES);
