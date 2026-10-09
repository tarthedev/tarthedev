import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { auditColumns, cents, oneOf, pk, softDelete, stId } from "./columns";
import { PRICEBOOK_KINDS } from "./enums";

/**
 * Flat-rate pricebook. `spiff_cents` is the item spiff (docs/02 section 7);
 * `combo_tags` are what combo rules match on (e.g. uv_light, surge_protector,
 * membership, leak_shutoff, water_filter_or_softener).
 * `member_price_cents` null means no separate member price.
 */
export const pricebookItems = pgTable(
  "pricebook_items",
  {
    id: pk(),
    stId: stId(),
    kind: text("kind", { enum: PRICEBOOK_KINDS }).notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    priceCents: cents("price_cents").notNull(),
    memberPriceCents: cents("member_price_cents"),
    costCents: cents("cost_cents").notNull().default(0),
    estMinutes: integer("est_minutes"),
    taxable: boolean("taxable").notNull().default(false),
    spiffCents: cents("spiff_cents").notNull().default(0),
    comboTags: text("combo_tags").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("pricebook_items_code_key").on(t.code),
    uniqueIndex("pricebook_items_st_id_key").on(t.stId),
    index("pricebook_items_category_idx").on(t.category),
    check("pricebook_items_kind_check", oneOf(t.kind, PRICEBOOK_KINDS)),
    check(
      "pricebook_items_money_check",
      sql`${t.priceCents} >= 0 and ${t.costCents} >= 0 and ${t.spiffCents} >= 0 and (${t.memberPriceCents} is null or ${t.memberPriceCents} >= 0)`,
    ),
  ],
);

export type PricebookItem = typeof pricebookItems.$inferSelect;
export type NewPricebookItem = typeof pricebookItems.$inferInsert;
