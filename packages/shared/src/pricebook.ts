import { z } from "zod";
import {
  centsSchema,
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  searchTextSchema,
} from "./common";
import { pricebookKindSchema } from "./values";

/**
 * GET /api/pricebook?q=&kind=&category=&includeInactive=&page=&pageSize= (office roles).
 * `q` matches code, name and description; every word must match. Sorted by
 * category, then name.
 */
export const pricebookQuerySchema = pageQuerySchema.extend({
  q: searchTextSchema,
  kind: pricebookKindSchema.optional(),
  category: z.string().trim().min(1).max(100).optional(),
  includeInactive: queryBooleanSchema.default(false),
});
export type PricebookQuery = z.infer<typeof pricebookQuerySchema>;

export const pricebookItemSchema = z.object({
  id: z.string(),
  stId: z.string().nullable(),
  kind: pricebookKindSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  priceCents: centsSchema,
  /** null = no separate member price. */
  memberPriceCents: centsSchema.nullable(),
  costCents: centsSchema,
  estMinutes: z.int().nullable(),
  taxable: z.boolean(),
  /** Item spiff (docs/02-commission-plan.md, section 7). */
  spiffCents: centsSchema,
  comboTags: z.array(z.string()),
  active: z.boolean(),
});
export type PricebookItemResponse = z.infer<typeof pricebookItemSchema>;

export const pricebookListResponseSchema = pageSchema(pricebookItemSchema);
export type PricebookListResponse = z.infer<typeof pricebookListResponseSchema>;
