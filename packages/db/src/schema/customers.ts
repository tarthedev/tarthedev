import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  auditColumns,
  bps,
  cents,
  localDate,
  oneOf,
  pk,
  softDelete,
  stId,
  subsetOf,
  timestamptz,
  userRef,
} from "./columns";
import {
  CUSTOMER_TYPES,
  EQUIPMENT_KINDS,
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_VISIT_KINDS,
} from "./enums";
import { businessUnits } from "./people";

/** The bill-to party. Commercial customers can have many locations. */
export const customers = pgTable(
  "customers",
  {
    id: pk(),
    stId: stId(),
    type: text("type", { enum: CUSTOMER_TYPES }).notNull(),
    name: text("name").notNull(),
    email: text("email"),
    billStreet: text("bill_street"),
    billStreet2: text("bill_street2"),
    billCity: text("bill_city"),
    billState: text("bill_state"),
    billZip: text("bill_zip"),
    /** 0 = due on receipt; N = net N days. */
    termsNetDays: integer("terms_net_days").notNull().default(0),
    poRequired: boolean("po_required").notNull().default(false),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    notes: text("notes"),
    qboCustomerId: text("qbo_customer_id"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("customers_st_id_key").on(t.stId),
    uniqueIndex("customers_qbo_customer_id_key").on(t.qboCustomerId),
    index("customers_name_idx").on(sql`lower(${t.name})`),
    check("customers_type_check", oneOf(t.type, CUSTOMER_TYPES)),
    check("customers_terms_check", sql`${t.termsNetDays} >= 0`),
  ],
);

/** A service address. */
export const locations = pgTable(
  "locations",
  {
    id: pk(),
    stId: stId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Site name for commercial locations (e.g. "Store #4"). */
    name: text("name"),
    street: text("street").notNull(),
    street2: text("street2"),
    city: text("city").notNull(),
    state: text("state").notNull().default("NC"),
    zip: text("zip").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accessNotes: text("access_notes"),
    defaultBusinessUnitId: uuid("default_business_unit_id").references(() => businessUnits.id),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("locations_st_id_key").on(t.stId),
    index("locations_customer_id_idx").on(t.customerId),
    index("locations_zip_idx").on(t.zip),
  ],
);

/** People at a customer. Phones are E.164 (+12525550123) for screen-pop lookups. */
export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    stId: stId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    locationId: uuid("location_id").references(() => locations.id),
    name: text("name").notNull(),
    phone: text("phone"),
    altPhone: text("alt_phone"),
    email: text("email"),
    textOptIn: boolean("text_opt_in").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("contacts_st_id_key").on(t.stId),
    index("contacts_customer_id_idx").on(t.customerId),
    index("contacts_location_id_idx").on(t.locationId),
    index("contacts_phone_idx").on(t.phone),
    index("contacts_alt_phone_idx").on(t.altPhone),
    index("contacts_email_idx").on(sql`lower(${t.email})`),
  ],
);

export const equipment = pgTable(
  "equipment",
  {
    id: pk(),
    stId: stId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    kind: text("kind", { enum: EQUIPMENT_KINDS }).notNull(),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    installYear: integer("install_year"),
    warrantyEnd: localDate("warranty_end"),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("equipment_st_id_key").on(t.stId),
    index("equipment_location_id_idx").on(t.locationId),
    check("equipment_kind_check", oneOf(t.kind, EQUIPMENT_KINDS)),
    check(
      "equipment_install_year_check",
      sql`${t.installYear} is null or ${t.installYear} between 1900 and 2100`,
    ),
  ],
);

export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: pk(),
    stId: stId(),
    name: text("name").notNull(),
    priceCents: cents("price_cents").notNull(),
    termMonths: integer("term_months").notNull().default(12),
    visits: integer("visits").notNull().default(2),
    visitKinds: text("visit_kinds", { enum: MEMBERSHIP_VISIT_KINDS })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Default member discount for items without their own member price. */
    memberDiscountBps: bps("member_discount_bps").notNull().default(0),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("membership_plans_st_id_key").on(t.stId),
    check("membership_plans_price_check", sql`${t.priceCents} >= 0`),
    check("membership_plans_discount_check", sql`${t.memberDiscountBps} between 0 and 10000`),
    check("membership_plans_visit_kinds_check", subsetOf(t.visitKinds, MEMBERSHIP_VISIT_KINDS)),
  ],
);

/** One row per membership term at a location. */
export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    stId: stId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => membershipPlans.id),
    status: text("status", { enum: MEMBERSHIP_STATUSES }).notNull(),
    startDate: localDate("start_date").notNull(),
    endDate: localDate("end_date").notNull(),
    visitsRemaining: integer("visits_remaining").notNull(),
    /** Price charged for this term. */
    priceCents: cents("price_cents").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(false),
    stripePaymentMethodId: text("stripe_payment_method_id"),
    soldByUserId: userRef("sold_by_user_id"),
    canceledAt: timestamptz("canceled_at"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("memberships_st_id_key").on(t.stId),
    index("memberships_location_id_idx").on(t.locationId),
    index("memberships_plan_id_idx").on(t.planId),
    index("memberships_end_date_idx").on(t.endDate),
    check("memberships_status_check", oneOf(t.status, MEMBERSHIP_STATUSES)),
    check("memberships_dates_check", sql`${t.endDate} > ${t.startDate}`),
    check("memberships_visits_check", sql`${t.visitsRemaining} >= 0`),
    check("memberships_price_check", sql`${t.priceCents} >= 0`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Equipment = typeof equipment.$inferSelect;
export type NewEquipment = typeof equipment.$inferInsert;
export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type NewMembershipPlan = typeof membershipPlans.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
