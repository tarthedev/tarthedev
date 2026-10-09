import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
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
} from "./columns";
import { BUSINESS_UNIT_CODES, SKILLS } from "./enums";

/** Departments; each maps to a QuickBooks class for the P&L. */
export const businessUnits = pgTable(
  "business_units",
  {
    id: pk(),
    stId: stId(),
    code: text("code", { enum: BUSINESS_UNIT_CODES }).notNull(),
    name: text("name").notNull(),
    qboClass: text("qbo_class"),
    active: boolean("active").notNull().default(true),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("business_units_code_key").on(t.code),
    uniqueIndex("business_units_st_id_key").on(t.stId),
    check("business_units_code_check", oneOf(t.code, BUSINESS_UNIT_CODES)),
  ],
);

/**
 * Staff details beside the Better Auth `user` row (one employee per user).
 * Pay is in `pay_rates`, never here.
 */
export const employees = pgTable(
  "employees",
  {
    id: pk(),
    stId: stId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** E.164, e.g. +12525550123. */
    phone: text("phone"),
    /** Object-storage key of the photo used in "on my way" texts. */
    photoKey: text("photo_key"),
    skills: text("skills", { enum: SKILLS }).array().notNull().default(sql`'{}'::text[]`),
    /** Business unit codes this person works in. */
    businessUnits: text("business_units", { enum: BUSINESS_UNIT_CODES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hiredOn: localDate("hired_on"),
    /** Default weekly shift, e.g. { mon: ["07:30", "16:30"], ... }. */
    shiftTemplate: jsonb("shift_template"),
    notes: text("notes"),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("employees_user_id_key").on(t.userId),
    uniqueIndex("employees_st_id_key").on(t.stId),
    index("employees_phone_idx").on(t.phone),
    check("employees_skills_check", subsetOf(t.skills, SKILLS)),
    check("employees_business_units_check", subsetOf(t.businessUnits, BUSINESS_UNIT_CODES)),
  ],
);

/**
 * Effective-dated wage and burden per worker (CLAUDE.md rule 7). A change is a
 * new row with a later `effective_from`; existing rows are never rewritten.
 * Burdened hourly cost = wage_cents_per_hour x burden_bps / 10000 (13000 = x1.30).
 * `effective_from` is inclusive, `effective_to` exclusive (null = open-ended),
 * both business-local dates.
 */
export const payRates = pgTable(
  "pay_rates",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    wageCentsPerHour: cents("wage_cents_per_hour").notNull(),
    burdenBps: bps("burden_bps").notNull().default(13000),
    effectiveFrom: localDate("effective_from").notNull(),
    effectiveTo: localDate("effective_to"),
    reason: text("reason"),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("pay_rates_user_id_effective_from_key").on(t.userId, t.effectiveFrom),
    check("pay_rates_wage_check", sql`${t.wageCentsPerHour} >= 0`),
    check("pay_rates_burden_check", sql`${t.burdenBps} >= 10000`),
    check(
      "pay_rates_effective_range_check",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

export type BusinessUnit = typeof businessUnits.$inferSelect;
export type NewBusinessUnit = typeof businessUnits.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type PayRate = typeof payRates.$inferSelect;
export type NewPayRate = typeof payRates.$inferInsert;
